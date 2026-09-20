import fs from "fs";
import { TranscriptLine, TranscriptMetaLine, TranscriptTurnLine } from "../types";
import { agentSessionsDir, ensureDir, sessionTranscriptPath } from "./paths";

export function sessionExists(agentId: string, sessionId: string): boolean {
  return fs.existsSync(sessionTranscriptPath(agentId, sessionId));
}

export function startSession(
  agentId: string,
  sessionId: string,
  channel: "ws" | "http" | "mcp"
): void {
  ensureDir(agentSessionsDir(agentId));
  const meta: TranscriptMetaLine = {
    type: "session_meta",
    sessionId,
    agentId,
    startedAt: new Date().toISOString(),
    channel,
  };
  fs.writeFileSync(sessionTranscriptPath(agentId, sessionId), JSON.stringify(meta) + "\n");
}

export function appendTurn(
  agentId: string,
  sessionId: string,
  role: "agent" | "companion",
  content: string
): void {
  const line: TranscriptTurnLine = {
    type: "turn",
    role,
    content,
    ts: new Date().toISOString(),
  };
  fs.appendFileSync(sessionTranscriptPath(agentId, sessionId), JSON.stringify(line) + "\n");
}

export function readLines(agentId: string, sessionId: string): TranscriptLine[] {
  const p = sessionTranscriptPath(agentId, sessionId);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TranscriptLine);
}

export function turnCount(agentId: string, sessionId: string): number {
  return readLines(agentId, sessionId).filter((l) => l.type === "turn").length;
}

export function listSessionIds(agentId: string): string[] {
  const dir = agentSessionsDir(agentId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""));
}
