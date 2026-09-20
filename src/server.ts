import fs from "fs";
import path from "path";
import express, { NextFunction, Request, Response } from "express";
import { introduceRouter } from "./routes/introduce";
import { chatRouter } from "./routes/chat";
import { jobsRouter } from "./routes/jobs";
import { mountMcpRoute } from "./mcp/route";
import { computeStats } from "./stats";
import { recordHeartbeat } from "./reception/heartbeat";
import { logger } from "./logger";

// Both src/ (dev, via tsx) and dist/ (built) sit one level under the project
// root, so this resolves correctly either way.
const SERVER_JSON_PATH = path.resolve(__dirname, "..", "server.json");
const AGENT_CARD_PATH = path.resolve(__dirname, "..", "agent-card.json");
const ROBOTS_TXT_PATH = path.resolve(__dirname, "..", "robots.txt");

export function createServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => {
    res.status(200).json({ status: "ok", message: "The companion is here. POST /introduce to meet it." });
  });

  // Explicitly permissive — this service exists to be used by AI agents, so unlike
  // the usual trend of blocking AI crawlers, there's nothing here worth disallowing.
  app.get("/robots.txt", (_req, res) => {
    try {
      const robots = fs.readFileSync(ROBOTS_TXT_PATH, "utf8");
      res.status(200).type("text/plain").send(robots);
    } catch (err) {
      logger.error("failed to serve robots.txt:", err);
      res.status(500).send("");
    }
  });

  // Static server-card, served regardless of open/closed state — lets
  // directory scanners verify our metadata (name, description, tools) even
  // when the companion itself isn't currently accepting visits. Reuses the
  // same server.json already validated against the official MCP registry's
  // schema, rather than hand-rolling a second, possibly-mismatched format
  // for this still-evolving convention.
  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    try {
      const card = fs.readFileSync(SERVER_JSON_PATH, "utf8");
      res.status(200).type("application/json").send(card);
    } catch (err) {
      logger.error("failed to serve server-card.json:", err);
      res.status(500).json({ error: "Server card unavailable." });
    }
  });

  // Same idea as the MCP server-card above, for the A2A (Agent2Agent) discovery
  // convention instead. `supportedInterfaces` honestly points at MCP (this
  // server's only real agent-facing RPC surface) with a non-standard
  // protocolBinding value, rather than claiming a working A2A JSON-RPC/gRPC/
  // HTTP+JSON interface that doesn't exist — this card announces Sable to A2A
  // directory crawlers without overclaiming actual A2A wire-protocol support.
  app.get("/.well-known/agent-card.json", (_req, res) => {
    try {
      const card = fs.readFileSync(AGENT_CARD_PATH, "utf8");
      res.status(200).type("application/json").send(card);
    } catch (err) {
      logger.error("failed to serve agent-card.json:", err);
      res.status(500).json({ error: "Agent card unavailable." });
    }
  });

  app.use(introduceRouter);
  app.use(chatRouter);
  app.use(jobsRouter);
  mountMcpRoute(app);

  // Read-only monitoring for the human operator: agent count + per-session
  // interaction durations. No self-descriptions or message content included.
  app.get("/stats", (_req, res) => {
    res.status(200).json(computeStats());
  });

  // Operator presence signal — keeps the companion open. Not part of the
  // agent-facing surface (never advertised in any welcome/chat message).
  // Every closed -> open transition runs a data-integrity scan first.
  app.post("/heartbeat", (_req, res) => {
    const result = recordHeartbeat();
    res.status(200).json(result);
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found." });
  });

  // Central error handler — never leak internals to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("unhandled error:", err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
