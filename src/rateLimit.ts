import { Request, Response, NextFunction } from "express";
import { config } from "./config";

const hits = new Map<string, number[]>();

function isLimited(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= max) {
    hits.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return false;
}

/** Shared by the REST /introduce middleware and the MCP introduce_yourself tool. */
export function isIntroduceRateLimited(key: string): boolean {
  return isLimited(key, config.INTRODUCE_RATE_LIMIT_WINDOW_MS, config.INTRODUCE_RATE_LIMIT_MAX);
}

/** IP-based sliding-window guard for /introduce — the only unauthenticated REST endpoint. */
export function introduceRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? "unknown";
  if (isIntroduceRateLimited(key)) {
    res.status(429).json({ error: "Too many introduction attempts. Try again later." });
    return;
  }
  next();
}

/** Shared by the REST apply route and the MCP apply_to_job tool. Keyed per-agent
 * (not per-IP) since applying already requires an authenticated token. */
export function isApplyRateLimited(agentId: string): boolean {
  return isLimited(`apply:${agentId}`, config.APPLY_RATE_LIMIT_WINDOW_MS, config.APPLY_RATE_LIMIT_MAX);
}
