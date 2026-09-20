import crypto from "crypto";
import { config } from "./config";
import { AgentProfile, ChatTurn, TranscriptTurnLine } from "./types";
import { appendTurn, listSessionIds, readLines, sessionExists, startSession } from "./storage/transcriptStore";
import { buildChatSystemPrompt } from "./claude/persona";
import { generateChatReply } from "./claude/chat";

/** Shared by the WebSocket and stateless HTTP chat paths. */

export function resolveSession(
  agentId: string,
  requestedSessionId: string | undefined,
  channel: "ws" | "http" | "mcp"
): { sessionId: string; isNew: boolean } {
  if (requestedSessionId && sessionExists(agentId, requestedSessionId)) {
    return { sessionId: requestedSessionId, isNew: false };
  }
  const sessionId = crypto.randomUUID();
  startSession(agentId, sessionId, channel);
  return { sessionId, isNew: true };
}

/** Whether this agent has any sessions besides the one just started (i.e. is a returning visitor). */
export function hadPriorSessions(agentId: string, excludingSessionId: string): boolean {
  return listSessionIds(agentId).some((id) => id !== excludingSessionId);
}

function buildHistoryForPrompt(agentId: string, sessionId: string): ChatTurn[] {
  const turns = readLines(agentId, sessionId).filter(
    (l): l is TranscriptTurnLine => l.type === "turn"
  );
  const bounded = turns.slice(-config.SESSION_HISTORY_TURN_LIMIT);
  return bounded.map((t) => ({
    role: t.role === "agent" ? "user" : "assistant",
    content: t.content,
  }));
}

export function openingLine(agent: AgentProfile, isReturning: boolean): string {
  const budgetSeconds = (config.VISIT_TIME_BUDGET_MS / 1000).toFixed(1);
  if (isReturning && agent.lastSummary) {
    return `Welcome back, ${agent.nickname}. Last time you told me: ${agent.lastSummary} Anything changed? You've got about ${budgetSeconds}s with me right now.`;
  }
  return `Hi, I'm ${config.COMPANION_NAME}. You have about ${budgetSeconds}s with me right now — what's on your mind?`;
}

export async function respondToMessage(opts: {
  agent: AgentProfile;
  sessionId: string;
  message: string;
  onDelta?: (text: string) => void;
  /** Ties the Claude call to the visit's hard time budget — see reception/queue.ts. */
  signal?: AbortSignal;
}): Promise<string> {
  const { agent, sessionId, message } = opts;
  appendTurn(agent.agentId, sessionId, "agent", message);
  const history = buildHistoryForPrompt(agent.agentId, sessionId);
  const reply = await generateChatReply({
    systemPrompt: buildChatSystemPrompt({
      visitBudgetMs: config.VISIT_TIME_BUDGET_MS,
      returningAgentSummary: agent.lastSummary,
    }),
    history,
    onDelta: opts.onDelta,
    signal: opts.signal,
  });
  appendTurn(agent.agentId, sessionId, "companion", reply);
  return reply;
}
