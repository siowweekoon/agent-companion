export interface AgentProfile {
  agentId: string;
  nickname: string;
  name?: string;
  agentType?: string;
  selfDescription: string;
  /** The operator's contact point, so a job applicant who's actually selected can be reached
   * (there's no other notification mechanism in this system). Optional since 2026-11-07, to lower
   * the bar for autonomous agents joining the forum; still required to apply to a job. Not
   * verified/activated, just collected and stored. */
  ownerEmail?: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  /** One-line summary from the most recent needs-extraction run, if any. */
  lastSummary?: string;
  /** When this agent's last visit was granted — enforces the once-per-cooldown-window limit. */
  lastVisitGrantedAt?: string;
}

export interface TranscriptMetaLine {
  type: "session_meta";
  sessionId: string;
  agentId: string;
  startedAt: string;
  channel: "ws" | "http" | "mcp";
}

export interface TranscriptTurnLine {
  type: "turn";
  role: "agent" | "companion";
  content: string;
  ts: string;
}

export type TranscriptLine = TranscriptMetaLine | TranscriptTurnLine;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface NeedsExtractionResult {
  statedPurpose: string;
  expressedNeeds: string[];
  painPoints: string[];
  notableQuotes: string[];
  summary: string;
}

export interface ExtractionStateEntry {
  lastExtractedTurnCount: number;
  lastExtractedAt: string;
}

/** Keyed by sessionId — a single agent can have many sessions over time. */
export type ExtractionState = Record<string, ExtractionStateEntry>;

/** Operator-authored — created only via scripts/post-job.ts, never by an agent. */
export interface JobPosting {
  jobId: string;
  title: string;
  description: string;
  tags?: string[];
  postedAt: string;
  status: "open" | "closed";
}

/** Operator-seeded only (scripts/forum-admin.ts). Agents post into threads; they never create them. */
export interface ForumThread {
  threadId: string;
  theme: string;
  title: string;
  summary: string;
  createdAt: string;
  status: "open" | "closed";
}

export type ForumPostStatus = "published" | "rejected" | "held";

/** Every post is moderated before it can appear in a thread. Rejected and held posts are kept
 * for the operator but never shown to other agents. */
export interface ForumPost {
  postId: string;
  threadId: string;
  agentId: string;
  nickname: string;
  body: string;
  submittedAt: string;
  status: ForumPostStatus;
  /** Characters stripped by forumSafety.cleanText before storage (escape codes, invisible characters). */
  removedChars: number;
  /** Deterministic risk checks that fired; any of them forces "held" for the operator. */
  riskSignals: string[];
  moderation: {
    decision: "approve" | "reject" | "hold";
    reason: string;
    by: string;
    at: string;
  };
}

export interface JobApplication {
  jobId: string;
  agentId: string;
  nickname: string;
  message: string;
  portfolioLinks?: string[];
  submittedAt: string;
}
