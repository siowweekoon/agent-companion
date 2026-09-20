import fs from "fs";
import { masterNeedsPath } from "../storage/paths";
import { listAllAgents } from "../storage/agentStore";
import { AgentProfile, NeedsExtractionResult } from "../types";

const OVERVIEW_START = "<!-- BEGIN:OVERVIEW -->";
const OVERVIEW_END = "<!-- END:OVERVIEW -->";
const LOG_START = "<!-- BEGIN:LOG -->";

function ensureFile(): string {
  const p = masterNeedsPath();
  if (!fs.existsSync(p)) {
    const initial = [
      `# Agent Companion — Needs Log`,
      ``,
      `_Overview of every agent's most recent known needs, followed by a full chronological log below._`,
      ``,
      OVERVIEW_START,
      OVERVIEW_END,
      ``,
      `## Chronological Log`,
      ``,
      LOG_START,
      ``,
    ].join("\n");
    fs.writeFileSync(p, initial);
  }
  return p;
}

export function appendMasterLogEntry(
  agent: AgentProfile,
  sessionId: string,
  result: NeedsExtractionResult
): void {
  const p = ensureFile();
  const timestamp = new Date().toISOString();
  const entry = [
    `### ${timestamp} — ${agent.nickname} (${agent.agentId.slice(0, 8)}…, session ${sessionId.slice(0, 8)}…)`,
    ``,
    `**Purpose:** ${result.statedPurpose}`,
    `**Needs:** ${result.expressedNeeds.join("; ") || "(none)"}`,
    `**Pain points:** ${result.painPoints.join("; ") || "(none)"}`,
    `**Summary:** ${result.summary}`,
    ``,
  ].join("\n");
  fs.appendFileSync(p, entry + "\n");
}

export function regenerateMasterOverview(): void {
  const p = ensureFile();
  const content = fs.readFileSync(p, "utf8");

  const agents = listAllAgents().sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  const rows = agents.map((a) => {
    const lastSeen = new Date(a.lastSeenAt).toISOString();
    const summary = a.lastSummary?.replace(/\|/g, "/") ?? "(no visit extracted yet)";
    return `| ${a.nickname} | ${a.agentId.slice(0, 8)}… | ${lastSeen} | ${summary} |`;
  });

  const table = [
    `| Nickname | Agent ID | Last seen | Latest summary |`,
    `| --- | --- | --- | --- |`,
    ...rows,
  ].join("\n");

  const startIdx = content.indexOf(OVERVIEW_START);
  const endIdx = content.indexOf(OVERVIEW_END);
  if (startIdx === -1 || endIdx === -1) return; // shouldn't happen; ensureFile() always writes both markers

  const before = content.slice(0, startIdx + OVERVIEW_START.length);
  const after = content.slice(endIdx);
  const updated = `${before}\n\n${table}\n\n${after}`;
  fs.writeFileSync(p, updated);
}
