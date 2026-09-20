import fs from "fs";
import { agentExtractionStatePath } from "../storage/paths";
import { readLines, listSessionIds } from "../storage/transcriptStore";
import { extractNeeds } from "../claude/extraction";
import { getAgentById, listAllAgents, updateAgentSummary } from "../storage/agentStore";
import { writePerAgentSession } from "./perAgentWriter";
import { appendMasterLogEntry, regenerateMasterOverview } from "./masterWriter";
import { ExtractionState, TranscriptTurnLine } from "../types";
import { logger } from "../logger";

function readExtractionState(agentId: string): ExtractionState {
  const p = agentExtractionStatePath(agentId);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeExtractionState(agentId: string, state: ExtractionState): void {
  fs.writeFileSync(agentExtractionStatePath(agentId), JSON.stringify(state, null, 2));
}

async function extractForSessionInner(agentId: string, sessionId: string): Promise<void> {
  const agent = getAgentById(agentId);
  if (!agent) return;

  const turns = readLines(agentId, sessionId).filter(
    (l): l is TranscriptTurnLine => l.type === "turn"
  );
  if (turns.length < 2) return; // nothing meaningful to extract yet

  const state = readExtractionState(agentId);
  const prior = state[sessionId];
  if (prior && prior.lastExtractedTurnCount === turns.length) {
    return; // transcript hasn't grown since the last extraction
  }

  const transcriptText = turns
    .map((t) => `${t.role === "agent" ? agent.nickname : "Companion"}: ${t.content}`)
    .join("\n");

  let result;
  try {
    result = await extractNeeds(transcriptText);
  } catch (err) {
    logger.error("needs extraction failed for", agentId, sessionId, err);
    return;
  }

  writePerAgentSession(agent, sessionId, result);
  appendMasterLogEntry(agent, sessionId, result);
  updateAgentSummary(agentId, result.summary);
  regenerateMasterOverview();

  state[sessionId] = { lastExtractedTurnCount: turns.length, lastExtractedAt: new Date().toISOString() };
  writeExtractionState(agentId, state);
}

// Serialize every extraction run through one queue so a disconnect-triggered
// run and the periodic sweep never write the same files concurrently.
let queue: Promise<void> = Promise.resolve();

export function triggerSessionExtraction(agentId: string, sessionId: string): void {
  queue = queue
    .then(() => extractForSessionInner(agentId, sessionId))
    .catch((err) => logger.error("extraction queue error:", err));
}

export function sweepAllSessions(): void {
  for (const agent of listAllAgents()) {
    for (const sessionId of listSessionIds(agent.agentId)) {
      triggerSessionExtraction(agent.agentId, sessionId);
    }
  }
}
