import { listAllAgents } from "./storage/agentStore";
import { listSessionIds, readLines } from "./storage/transcriptStore";
import { receptionQueue } from "./reception/queue";
import { isOpen } from "./reception/openState";
import { TranscriptMetaLine, TranscriptTurnLine } from "./types";

export interface SessionStat {
  sessionId: string;
  channel: "ws" | "http" | "mcp";
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  turnCount: number;
}

export interface AgentStat {
  agentId: string;
  nickname: string;
  createdAt: string;
  lastSeenAt: string;
  sessionCount: number;
  totalInteractionMs: number;
  sessions: SessionStat[];
}

export interface CompanionStats {
  totalAgents: number;
  totalSessions: number;
  open: boolean;
  currentlyActive: boolean;
  queueLength: number;
  agents: AgentStat[];
}

function computeSessionStat(agentId: string, sessionId: string): SessionStat {
  const lines = readLines(agentId, sessionId);
  const meta = lines.find((l): l is TranscriptMetaLine => l.type === "session_meta");
  const turns = lines.filter((l): l is TranscriptTurnLine => l.type === "turn");
  const startedAt = meta?.startedAt ?? turns[0]?.ts ?? new Date(0).toISOString();
  const lastTurn = turns[turns.length - 1];
  const endedAt = lastTurn ? lastTurn.ts : null;
  const durationMs = endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  return {
    sessionId,
    channel: meta?.channel ?? "http",
    startedAt,
    endedAt,
    durationMs,
    turnCount: turns.length,
  };
}

/** Read-only aggregate stats for the human operator — no self-descriptions or message content included. */
export function computeStats(): CompanionStats {
  const agents = listAllAgents();
  let totalSessions = 0;

  const agentStats: AgentStat[] = agents.map((agent) => {
    const sessionIds = listSessionIds(agent.agentId);
    totalSessions += sessionIds.length;
    const sessions = sessionIds
      .map((sid) => computeSessionStat(agent.agentId, sid))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const totalInteractionMs = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    return {
      agentId: agent.agentId,
      nickname: agent.nickname,
      createdAt: agent.createdAt,
      lastSeenAt: agent.lastSeenAt,
      sessionCount: sessions.length,
      totalInteractionMs,
      sessions,
    };
  });

  agentStats.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));

  return {
    totalAgents: agents.length,
    totalSessions,
    open: isOpen(),
    currentlyActive: receptionQueue.hasActiveVisit(),
    queueLength: receptionQueue.queueLength(),
    agents: agentStats,
  };
}
