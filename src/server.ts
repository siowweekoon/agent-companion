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

export function createServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => {
    res.status(200).json({ status: "ok", message: "The companion is here. POST /introduce to meet it." });
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
