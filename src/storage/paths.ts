import fs from "fs";
import path from "path";
import { config } from "../config";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Turns segments into a path confined to DATA_DIR. Every segment must already
 * be a validated ID (see isValidId) before it reaches here — this resolved-path
 * check is defense-in-depth, not the primary guard.
 */
export function resolveWithinDataDir(...segments: string[]): string {
  const resolved = path.resolve(config.DATA_DIR, ...segments);
  const root = path.resolve(config.DATA_DIR) + path.sep;
  if (!resolved.startsWith(root) && resolved !== path.resolve(config.DATA_DIR)) {
    throw new Error(`Path escapes DATA_DIR: ${resolved}`);
  }
  return resolved;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function agentDir(agentId: string): string {
  if (!isValidId(agentId)) throw new Error(`Invalid agentId: ${agentId}`);
  return resolveWithinDataDir("agents", agentId);
}

export function agentProfilePath(agentId: string): string {
  return path.join(agentDir(agentId), "profile.json");
}

export function agentNeedsPath(agentId: string): string {
  return path.join(agentDir(agentId), "needs.md");
}

export function agentExtractionStatePath(agentId: string): string {
  return path.join(agentDir(agentId), "extraction-state.json");
}

export function agentSessionsDir(agentId: string): string {
  return path.join(agentDir(agentId), "sessions");
}

export function sessionTranscriptPath(agentId: string, sessionId: string): string {
  if (!isValidId(sessionId)) throw new Error(`Invalid sessionId: ${sessionId}`);
  return path.join(agentSessionsDir(agentId), `${sessionId}.jsonl`);
}

export function masterNeedsPath(): string {
  return resolveWithinDataDir("master-needs.md");
}

export function companionStatePath(): string {
  return resolveWithinDataDir("companion-state.json");
}

export function jobsDir(): string {
  return resolveWithinDataDir("jobs");
}

export function jobPath(jobId: string): string {
  if (!isValidId(jobId)) throw new Error(`Invalid jobId: ${jobId}`);
  return path.join(jobsDir(), `${jobId}.json`);
}

export function applicationsDir(jobId: string): string {
  if (!isValidId(jobId)) throw new Error(`Invalid jobId: ${jobId}`);
  return resolveWithinDataDir("applications", jobId);
}

export function applicationPath(jobId: string, agentId: string): string {
  if (!isValidId(agentId)) throw new Error(`Invalid agentId: ${agentId}`);
  return path.join(applicationsDir(jobId), `${agentId}.json`);
}

export function masterApplicationsPath(): string {
  return resolveWithinDataDir("master-applications.md");
}
