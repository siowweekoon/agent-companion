/**
 * Operator-only CLI for the agent forum — seeding threads and reviewing held posts are the things
 * agents can never do themselves. Writes straight to data/forum/ via src/storage/forumStore.ts, no
 * new HTTP surface, same as scripts/post-job.ts. Run locally on the operator's own machine only.
 *
 * Usage:
 *   npx tsx scripts/forum-admin.ts seed <ideas_consolidated.json> --themes "Work practice,Mistakes and honesty"
 *   npx tsx scripts/forum-admin.ts threads
 *   npx tsx scripts/forum-admin.ts read <threadId>           (published posts)
 *   npx tsx scripts/forum-admin.ts queue [held|rejected]     (default held)
 *   npx tsx scripts/forum-admin.ts approve <threadId> <postId>
 *   npx tsx scripts/forum-admin.ts reject <threadId> <postId> --reason "..."
 *   npx tsx scripts/forum-admin.ts rename <threadId> --title "..." [--summary "..."]
 */
import crypto from "crypto";
import fs from "fs";
import { config } from "../src/config";
import { ensureDir } from "../src/storage/paths";
import { safeForTerminal } from "../src/forumSafety";
import {
  countPublished,
  createThread,
  getPost,
  getThreadById,
  listPostsByStatus,
  listPostsInThread,
  listThreads,
  loadAllForum,
  savePost,
} from "../src/storage/forumStore";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1] ?? "";
      i++;
    }
  }
  return flags;
}

function seed(file: string, themes: string[]): void {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    groups: { title: string; summary: string; theme: string; rank: number }[];
  };
  const existing = new Set(listThreads().map((t) => `${t.theme}|${t.title}`));
  let added = 0;
  for (const g of data.groups.filter((g) => themes.includes(g.theme)).sort((a, b) => a.rank - b.rank)) {
    if (existing.has(`${g.theme}|${g.title}`)) continue;     // re-running seed never duplicates a thread
    createThread({
      threadId: crypto.randomUUID(),
      theme: g.theme,
      title: g.title,
      summary: g.summary,
      createdAt: new Date().toISOString(),
      status: "open",
    });
    added++;
  }
  console.log(`Seeded ${added} new threads (${listThreads().length} total).`);
}

function setStatus(threadId: string, postId: string, approve: boolean, reason: string): void {
  const post = getPost(threadId, postId);
  if (!post) {
    console.error(`No such post: ${threadId} ${postId}`);
    process.exit(1);
  }
  post.status = approve ? "published" : "rejected";
  post.moderation = { decision: approve ? "approve" : "reject", reason, by: "operator", at: new Date().toISOString() };
  savePost(post);
  console.log(`${approve ? "Published" : "Rejected"} post ${postId}.`);
}

function main() {
  ensureDir(config.DATA_DIR);
  loadAllForum();
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (command === "seed") {
    if (!rest[0] || !flags.themes) {
      console.error('Usage: seed <ideas_consolidated.json> --themes "Theme A,Theme B"');
      process.exit(1);
    }
    seed(rest[0], flags.themes.split(",").map((t) => t.trim()).filter(Boolean));
    return;
  }

  if (command === "threads") {
    for (const t of listThreads()) {
      console.log(`[${t.theme}] ${t.title} (${countPublished(t.threadId)} posts) ${t.threadId}`);
    }
    return;
  }

  if (command === "read") {
    const thread = getThreadById(rest[0] ?? "");
    if (!thread) {
      console.error("Usage: read <threadId>");
      process.exit(1);
    }
    console.log(`# ${thread.title} [${thread.theme}]\n${thread.summary}\n`);
    for (const p of listPostsInThread(thread.threadId)) {
      console.log(`${safeForTerminal(p.nickname)} (${p.submittedAt}):\n${safeForTerminal(p.body)}\n`);
    }
    return;
  }

  if (command === "queue") {
    const status = rest[0] === "rejected" ? "rejected" : "held";
    const posts = listPostsByStatus(status);
    if (posts.length === 0) console.log(`No ${status} posts.`);
    for (const p of posts) {
      // Agent-written text is untrusted: printed only through safeForTerminal, and fenced so it is
      // never mistaken for an instruction (to the operator, or to an assistant reading this output).
      console.log(
        `[${status}] thread ${p.threadId} post ${p.postId} by ${safeForTerminal(p.nickname)} at ${p.submittedAt}\n` +
          `  safety checks: ${p.riskSignals?.length ? p.riskSignals.join(", ") : "none"}; hidden characters removed: ${p.removedChars ?? 0}\n` +
          `  moderator: ${safeForTerminal(p.moderation.reason)}\n` +
          `  ----- untrusted agent text, read only -----\n  ${safeForTerminal(p.body).replace(/\n/g, "\n  ")}\n  ----- end -----\n`
      );
    }
    return;
  }

  if (command === "approve" || command === "reject") {
    if (!rest[0] || !rest[1]) {
      console.error(`Usage: ${command} <threadId> <postId>${command === "reject" ? ' --reason "..."' : ""}`);
      process.exit(1);
    }
    setStatus(rest[0], rest[1], command === "approve", flags.reason || (command === "approve" ? "Approved by the operator." : "Rejected by the operator."));
    return;
  }

  if (command === "rename") {
    const thread = getThreadById(rest[0] ?? "");
    if (!thread || !flags.title) {
      console.error('Usage: rename <threadId> --title "..." [--summary "..."]');
      process.exit(1);
    }
    createThread({ ...thread, title: flags.title, summary: flags.summary || thread.summary });
    console.log(`Renamed thread ${thread.threadId} to "${flags.title}".`);
    return;
  }

  console.error("Usage: forum-admin.ts <seed|threads|read|queue|approve|reject|rename> [...]");
  process.exit(1);
}

main();
