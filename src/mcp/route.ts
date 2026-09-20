import { Express, NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { buildMcpServer } from "./server";
import { config } from "../config";
import { logger } from "../logger";

const allowedHostnames = config.MCP_ALLOWED_HOSTNAMES.split(",")
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * DNS-rebinding hardening, second layer: reject cross-origin browser requests.
 * Non-browser HTTP clients (the typical MCP caller — another agent's backend
 * process) don't send an Origin header at all, so only requests that DO send
 * one are checked against the allowlist. This is the layer that specifically
 * stops a malicious webpage's JS from reaching this server via a victim's browser.
 */
function originValidation(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header("origin");
  if (!origin) {
    next();
    return;
  }
  const allowed = allowedHostnames.some((h) => origin.includes(h));
  if (!allowed) {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }
  next();
}

/**
 * Mounts the MCP endpoint in stateless mode: a fresh McpServer + transport
 * per request (see src/mcp/server.ts docstring). The MCP layer exposes only
 * two conversational tools — no filesystem, shell, or network-fetch tools —
 * so even a malicious tool call here has no path to anything on this machine
 * beyond the same companion chat the REST/WS routes already expose.
 */
export function mountMcpRoute(app: Express): void {
  const hostGuard = hostHeaderValidation(allowedHostnames);

  app.post("/mcp", hostGuard, originValidation, async (req, res) => {
    const server = buildMcpServer(req.ip ?? "unknown");
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      logger.error("mcp request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", hostGuard, originValidation, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/mcp", hostGuard, originValidation, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
}
