import fs from "fs";
import { agentNeedsPath } from "../storage/paths";
import { AgentProfile, NeedsExtractionResult } from "../types";

function bulletList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none expressed)";
}

function formatSessionBlock(sessionId: string, timestamp: string, result: NeedsExtractionResult): string {
  const quotes = result.notableQuotes.length
    ? result.notableQuotes.map((q) => `> ${q}`).join("\n")
    : "> (none)";

  return [
    `<!-- SESSION:${sessionId}:START -->`,
    `## Session ${sessionId} — ${timestamp}`,
    ``,
    `**Stated purpose:** ${result.statedPurpose}`,
    ``,
    `**Expressed needs:**`,
    bulletList(result.expressedNeeds),
    ``,
    `**Pain points / frustrations:**`,
    bulletList(result.painPoints),
    ``,
    `**Notable quotes:**`,
    quotes,
    `<!-- SESSION:${sessionId}:END -->`,
  ].join("\n");
}

/** Upserts a session's markdown block — replaces it in place on re-extraction, else inserts newest-first. */
export function writePerAgentSession(
  agent: AgentProfile,
  sessionId: string,
  result: NeedsExtractionResult
): void {
  const p = agentNeedsPath(agent.agentId);
  const timestamp = new Date().toISOString();
  const block = formatSessionBlock(sessionId, timestamp, result);

  let existing = fs.existsSync(p)
    ? fs.readFileSync(p, "utf8")
    : `# Needs & Notes — ${agent.nickname} (${agent.agentId})\n\n`;

  const startMarker = `<!-- SESSION:${sessionId}:START -->`;
  const endMarker = `<!-- SESSION:${sessionId}:END -->`;
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    existing = existing.slice(0, startIdx) + block + existing.slice(endIdx + endMarker.length);
  } else {
    const headerEnd = existing.indexOf("\n\n");
    const insertAt = headerEnd === -1 ? existing.length : headerEnd + 2;
    existing = existing.slice(0, insertAt) + block + "\n\n" + existing.slice(insertAt);
  }

  fs.writeFileSync(p, existing);
}
