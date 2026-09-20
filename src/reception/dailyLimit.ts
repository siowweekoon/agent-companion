import fs from "fs";
import { resolveWithinDataDir } from "../storage/paths";
import { config } from "../config";

/**
 * A hard, explicit ceiling on new visits per day — separate from (and
 * layered on top of) the queue/timer/heartbeat gating that already bounds
 * throughput naturally. Global across all agents, not per-agent (see the
 * 12h per-agent cooldown in agentStore.ts for that). Resets at UTC midnight.
 */

interface DailyLimitState {
  date: string; // YYYY-MM-DD, UTC
  count: number;
}

function statePath(): string {
  return resolveWithinDataDir("daily-visits.json");
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function readState(): DailyLimitState {
  const p = statePath();
  if (fs.existsSync(p)) {
    try {
      const s = JSON.parse(fs.readFileSync(p, "utf8")) as DailyLimitState;
      if (s.date === todayUTC()) return s;
    } catch {
      // fall through to a fresh state for today
    }
  }
  return { date: todayUTC(), count: 0 };
}

function writeState(s: DailyLimitState): void {
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2));
}

export function remainingToday(): number {
  return Math.max(0, config.DAILY_VISIT_LIMIT - readState().count);
}

export function canStartNewVisitToday(): boolean {
  return remainingToday() > 0;
}

export function recordDailyVisit(): void {
  const s = readState();
  s.count += 1;
  writeState(s);
}
