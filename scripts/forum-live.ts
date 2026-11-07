/**
 * Operator-only: runs the server with the agents-only forum LIVE for one window (at most 30 minutes),
 * prints a report every few minutes, then closes the forum and stops the server, so outside the window
 * nothing is received or sent. With --public it also opens the project's ngrok tunnel for the window,
 * and closes it at the end.
 *
 * Every request (any path) is printed live, and a watchdog stops everything at once on signs of
 * trouble: a crash, a flood of requests, many refused logins, or repeated server errors.
 *
 * Usage: npx tsx scripts/forum-live.ts [--minutes 30] [--report-every 5] [--public]
 */
import http from "http";
import { ChildProcess, spawn } from "child_process";
import { config } from "../src/config";
import { ensureDir } from "../src/storage/paths";
import { listAllAgents, loadAllAgents } from "../src/storage/agentStore";
import { loadAllJobs } from "../src/storage/jobStore";
import { getThreadById, listPostsByStatus, listPostsSince, loadAllForum, readForumAccessSince } from "../src/storage/forumStore";
import { loadOpenState } from "../src/reception/openState";
import { closeForumWindow, forumMsLeft, openForumWindow } from "../src/forumLive";
import { safeForTerminal } from "../src/forumSafety";
import { createServer } from "../src/server";

const MAX_MINUTES = 30;
// Watchdog limits per rolling minute. Rejected attack posts are expected and are NOT a reason to stop.
const LIMITS = { requests: 300, refused: 60, serverErrors: 5 };

function flag(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
}

function report(label: string, since: string, start: string): void {
  const access = readForumAccessSince(since);
  const agents = new Map<string, number>();
  let denied = 0;
  for (const a of access) {
    if (a.nickname) agents.set(safeForTerminal(a.nickname), (agents.get(safeForTerminal(a.nickname)) ?? 0) + 1);
    if (String(a.status).startsWith("40")) denied++;
  }
  const newAgents = listAllAgents().filter((a) => a.createdAt >= since);
  const posts = listPostsSince(since);
  const count = (s: string) => posts.filter((p) => p.status === s).length;
  const held = listPostsByStatus("held").filter((p) => p.submittedAt >= start);
  const lines = [
    `[forum-live] ${label} at ${new Date().toISOString()} | ${Math.ceil(forumMsLeft() / 60_000)} min left`,
    `[forum-live]   forum requests: ${access.length} (refused or denied: ${denied}); new agents introduced: ${newAgents.length}`,
    `[forum-live]   active agents: ${agents.size ? Array.from(agents, ([n, c]) => `${n} (${c})`).join(", ") : "none"}`,
    `[forum-live]   posts: published ${count("published")}, rejected ${count("rejected")}, held ${count("held")}`,
    ...held.slice(0, 5).map(
      (p) =>
        `[forum-live]   HELD in "${safeForTerminal(getThreadById(p.threadId)?.title ?? p.threadId)}" by ${safeForTerminal(p.nickname)}: ` +
        `${p.riskSignals.length ? p.riskSignals.join(", ") : safeForTerminal(p.moderation.reason).slice(0, 120)}`
    ),
  ];
  console.log(lines.join("\n"));
}

function main() {
  const minutes = Math.min(MAX_MINUTES, Math.max(1, flag("minutes", MAX_MINUTES)));
  const every = Math.max(1, flag("report-every", 5));
  const isPublic = process.argv.includes("--public");

  ensureDir(config.DATA_DIR);
  loadAllAgents();
  loadAllJobs();
  loadAllForum();
  loadOpenState();

  const start = new Date().toISOString();
  const until = openForumWindow(minutes);
  const server = http.createServer(createServer());
  let tunnel: ChildProcess | undefined;
  let lastReport = start;

  const recent: { t: number; status: number }[] = [];
  let stopping = false;
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.on("finish", () => {
      const now = Date.now();
      recent.push({ t: now, status: res.statusCode });
      while (recent.length && now - recent[0].t > 60_000) recent.shift();
      // Express rewrites req.url inside mounted routers (/forum/threads -> /threads); originalUrl keeps the full path.
      const url = (req as http.IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "";
      let path: string;
      try {
        path = decodeURIComponent(url.split("?")[0]);
      } catch {
        path = url.split("?")[0];      // a malformed %-sequence must not crash the watchdog
      }
      path = safeForTerminal(path).slice(0, 120);
      console.log(`[forum-live] req ${req.method} ${path} -> ${res.statusCode}`);
      const refused = recent.filter((r) => r.status === 401 || r.status === 403).length;
      const errors = recent.filter((r) => r.status >= 500 && r.status !== 503).length;
      if (!stopping && recent.length > LIMITS.requests) shutdown(`BREACH STOP: ${recent.length} requests in a minute (flood)`);
      else if (!stopping && refused > LIMITS.refused) shutdown(`BREACH STOP: ${refused} refused logins in a minute`);
      else if (!stopping && errors > LIMITS.serverErrors) shutdown(`BREACH STOP: ${errors} server errors in a minute`);
    });
  });
  process.on("uncaughtException", (err) => shutdown(`BREACH STOP: crash (${err.message})`));
  process.on("unhandledRejection", (err) => shutdown(`BREACH STOP: unhandled error (${String(err)})`));

  server.listen(config.PORT, config.HOST, () => {
    console.log(`[forum-live] OPEN on http://${config.HOST}:${config.PORT} until ${until.toISOString()} (${minutes} min, report every ${every} min)`);
    if (isPublic) {
      const domain = config.MCP_ALLOWED_HOSTNAMES.split(",").map((h) => h.trim()).find((h) => h.endsWith(".ngrok-free.dev"));
      if (!domain) {
        console.log("[forum-live] --public: no ngrok hostname in MCP_ALLOWED_HOSTNAMES, staying local");
      } else {
        tunnel = spawn("ngrok", ["http", `--url=${domain}`, String(config.PORT), "--log=stdout", "--log-level=warn"], { stdio: "ignore" });
        tunnel.on("error", (err) => console.log(`[forum-live] tunnel failed to start: ${err.message}`));
        console.log(`[forum-live] PUBLIC via https://${domain}`);
      }
    }
  });

  const timer = setInterval(() => {
    report(`${every}-minute report`, lastReport, start);
    lastReport = new Date().toISOString();
  }, every * 60_000);

  function shutdown(why: string): void {
    if (stopping) return;
    stopping = true;
    console.log(`[forum-live] STOPPING: ${why}`);
    clearInterval(timer);
    closeForumWindow();
    tunnel?.kill();
    server.close(() => {
      report(`FINAL report (${why})`, start, start);
      console.log("[forum-live] CLOSED: server stopped, nothing is received or sent until the next window.");
      process.exit(0);
    });
    // Agents mid-request shouldn't keep the window open.
    setTimeout(() => process.exit(0), 10_000).unref();
    server.closeAllConnections?.();
  }
  setTimeout(() => shutdown("window ended"), minutes * 60_000);
  process.on("SIGINT", () => shutdown("stopped by the operator"));
}

main();
