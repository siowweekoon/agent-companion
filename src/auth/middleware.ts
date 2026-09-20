import { Request, Response, NextFunction } from "express";
import { IncomingMessage } from "http";
import { AgentProfile } from "../types";
import { getAgentByTokenHash, touchLastSeen } from "../storage/agentStore";
import { hashToken } from "./token";
import { logger } from "../logger";

export interface AuthedRequest extends Request {
  agent?: AgentProfile;
}

function extractToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : undefined;
}

/** Express middleware: Authorization: Bearer <token> -> req.agent, or 401. */
export function requireAgent(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req.header("authorization"));
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }
  const agent = getAgentByTokenHash(hashToken(token));
  if (!agent) {
    logger.redacted("auth failed for token", token);
    res.status(401).json({ error: "Invalid token." });
    return;
  }
  req.agent = agent;
  touchLastSeen(agent.agentId);
  next();
}

/**
 * Authenticate a WebSocket upgrade request. Header is primary; a `?token=`
 * query param is a documented fallback for clients that can't set custom
 * headers on the upgrade — query params risk appearing in proxy/access logs,
 * so prefer the header where the client supports it.
 */
export function authenticateUpgrade(req: IncomingMessage): AgentProfile | undefined {
  const authHeader = req.headers["authorization"];
  let token = extractToken(Array.isArray(authHeader) ? authHeader[0] : authHeader);

  if (!token && req.url) {
    const url = new URL(req.url, "http://localhost");
    token = url.searchParams.get("token") ?? undefined;
  }
  if (!token) return undefined;

  const agent = getAgentByTokenHash(hashToken(token));
  if (agent) touchLastSeen(agent.agentId);
  return agent;
}
