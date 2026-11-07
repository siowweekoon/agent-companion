import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../config";

/**
 * Phase-0 demand test: counts only. No query contents are stored. A caller is a salted,
 * truncated SHA-256 of the IP so "distinct users" can be counted without keeping the IP.
 */
const USAGE_PATH = path.join(config.DATA_DIR, "property", "usage.jsonl");
const SALT = process.env.PROPERTY_HASH_SALT ?? "phase0-demand-test";

const PER_CALLER_DAILY = Number(process.env.PROPERTY_PER_CALLER_DAILY ?? 30);
const GLOBAL_DAILY = Number(process.env.PROPERTY_GLOBAL_DAILY ?? 2000);

const todayCounts = { day: "", global: 0, perCaller: new Map<string, number>() };

export function callerHash(ip: string): string {
  return crypto.createHash("sha256").update(SALT + ip).digest("hex").slice(0, 12);
}

/** Returns a reason string if the call should be refused, otherwise null (and counts the call). */
export function checkAndCountQuota(caller: string): string | null {
  const day = new Date().toISOString().slice(0, 10);
  if (todayCounts.day !== day) {
    todayCounts.day = day;
    todayCounts.global = 0;
    todayCounts.perCaller.clear();
  }
  if (todayCounts.global >= GLOBAL_DAILY) return "The free daily limit for this service has been reached. Try again after UTC midnight.";
  const used = todayCounts.perCaller.get(caller) ?? 0;
  if (used >= PER_CALLER_DAILY) return `Free limit of ${PER_CALLER_DAILY} calls per day reached. Try again after UTC midnight.`;
  todayCounts.global++;
  todayCounts.perCaller.set(caller, used + 1);
  return null;
}

export function logUsage(channel: "rest" | "mcp" | "web", caller: string, ok: boolean): void {
  try {
    fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true });
    fs.appendFileSync(USAGE_PATH, JSON.stringify({ ts: new Date().toISOString(), channel, caller, ok }) + "\n");
  } catch {
    // Never let logging break a request.
  }
}

export function usageSummary(days = 14) {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(USAGE_PATH, "utf8").split("\n").filter(Boolean);
  } catch {
    // no usage yet
  }
  const cutoff = Date.now() - days * 86_400_000;
  const callers = new Set<string>();
  const byChannel: Record<string, number> = {};
  let total = 0;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (new Date(e.ts).getTime() < cutoff || !e.ok) continue;
      total++;
      callers.add(e.caller);
      byChannel[e.channel] = (byChannel[e.channel] ?? 0) + 1;
    } catch {
      // skip a corrupt line
    }
  }
  return {
    windowDays: days,
    successfulCalls: total,
    distinctCallers: callers.size,
    byChannel,
    killCriteria: "Stop if fewer than 30 distinct callers or 300 successful calls in 14 days.",
  };
}
