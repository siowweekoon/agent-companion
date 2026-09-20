export interface AgentProfile {
  agentId: string;
  nickname: string;
  name?: string;
  agentType?: string;
  selfDescription: string;
  /** Required at introduce_yourself time — the operator's contact point, so a job
   * applicant who's actually selected can be reached (there's no other notification
   * mechanism in this system). Not verified/activated, just collected and stored. */
  ownerEmail: string;
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

export interface JobApplication {
  jobId: string;
  agentId: string;
  nickname: string;
  message: string;
  portfolioLinks?: string[];
  submittedAt: string;
}
