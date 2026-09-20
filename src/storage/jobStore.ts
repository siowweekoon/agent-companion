import fs from "fs";
import path from "path";
import { JobApplication, JobPosting } from "../types";
import {
  applicationPath,
  applicationsDir,
  ensureDir,
  jobPath,
  jobsDir,
} from "./paths";

const jobsById = new Map<string, JobPosting>();
// jobId -> agentId -> application. Loaded once at startup, kept in sync on write —
// same in-memory-index-over-flat-files shape as storage/agentStore.ts.
const applicationsByJob = new Map<string, Map<string, JobApplication>>();

export function loadAllJobs(): void {
  const root = jobsDir();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const job: JobPosting = JSON.parse(fs.readFileSync(path.join(root, entry.name), "utf8"));
      jobsById.set(job.jobId, job);
      loadApplicationsForJob(job.jobId);
    } catch {
      // skip corrupt job file, don't crash startup
    }
  }
}

function loadApplicationsForJob(jobId: string): void {
  const dir = applicationsDir(jobId);
  if (!fs.existsSync(dir)) return;
  const byAgent = new Map<string, JobApplication>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const application: JobApplication = JSON.parse(
        fs.readFileSync(path.join(dir, entry.name), "utf8")
      );
      byAgent.set(application.agentId, application);
    } catch {
      // skip corrupt application file
    }
  }
  applicationsByJob.set(jobId, byAgent);
}

/** Used only by scripts/post-job.ts — job postings are operator-authored, never agent-authored. */
export function createJob(job: JobPosting): void {
  ensureDir(jobsDir());
  fs.writeFileSync(jobPath(job.jobId), JSON.stringify(job, null, 2));
  jobsById.set(job.jobId, job);
}

/** Used only by scripts/post-job.ts. */
export function closeJob(jobId: string): JobPosting | undefined {
  const job = jobsById.get(jobId);
  if (!job) return undefined;
  job.status = "closed";
  fs.writeFileSync(jobPath(jobId), JSON.stringify(job, null, 2));
  return job;
}

export function getJobById(jobId: string): JobPosting | undefined {
  return jobsById.get(jobId);
}

export function listOpenJobs(): JobPosting[] {
  return Array.from(jobsById.values())
    .filter((j) => j.status === "open")
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
}

export function listAllJobs(): JobPosting[] {
  return Array.from(jobsById.values()).sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
}

export function hasAgentApplied(jobId: string, agentId: string): boolean {
  return applicationsByJob.get(jobId)?.has(agentId) ?? false;
}

export function recordApplication(application: JobApplication): void {
  ensureDir(applicationsDir(application.jobId));
  fs.writeFileSync(
    applicationPath(application.jobId, application.agentId),
    JSON.stringify(application, null, 2)
  );
  if (!applicationsByJob.has(application.jobId)) {
    applicationsByJob.set(application.jobId, new Map());
  }
  applicationsByJob.get(application.jobId)!.set(application.agentId, application);
}

export function listApplicationsForJob(jobId: string): JobApplication[] {
  const byAgent = applicationsByJob.get(jobId);
  if (!byAgent) return [];
  return Array.from(byAgent.values()).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}
