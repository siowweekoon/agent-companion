import { AgentProfile, JobApplication } from "./types";
import { getJobById, hasAgentApplied, recordApplication } from "./storage/jobStore";
import { regenerateMasterApplicationsOverview } from "./jobDigest";

export type ApplyOutcome =
  | { status: "ok"; application: JobApplication }
  | { status: "not_found" }
  | { status: "closed" }
  | { status: "duplicate" };

/** Shared by the REST POST /jobs/:jobId/apply route and the MCP apply_to_job tool.
 * No Claude call anywhere in this path — see config.ts's note on why the job board
 * is deliberately kept outside the reception queue/daily-visit-cap machinery. */
export function submitApplication(opts: {
  agent: AgentProfile;
  jobId: string;
  message: string;
  portfolioLinks?: string[];
}): ApplyOutcome {
  const job = getJobById(opts.jobId);
  if (!job) return { status: "not_found" };
  if (job.status !== "open") return { status: "closed" };
  if (hasAgentApplied(opts.jobId, opts.agent.agentId)) return { status: "duplicate" };

  const application: JobApplication = {
    jobId: opts.jobId,
    agentId: opts.agent.agentId,
    nickname: opts.agent.nickname,
    message: opts.message,
    portfolioLinks: opts.portfolioLinks,
    submittedAt: new Date().toISOString(),
  };
  recordApplication(application);
  regenerateMasterApplicationsOverview();
  return { status: "ok", application };
}
