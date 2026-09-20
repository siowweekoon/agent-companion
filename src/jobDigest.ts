import fs from "fs";
import { masterApplicationsPath } from "./storage/paths";
import { listAllJobs, listApplicationsForJob } from "./storage/jobStore";

/** Plain-code digest, no Claude call — unlike needsExtraction/masterWriter.ts's
 * chat-summary equivalent, an application's message is already human-readable,
 * there's nothing here that needs distilling. Regenerated wholesale on every
 * application (cheap: at most a few dozen jobs/applications expected). */
export function regenerateMasterApplicationsOverview(): void {
  const jobs = listAllJobs();

  const lines = [
    `# Agent Companion — Job Board`,
    ``,
    `_Regenerated on every new application. Applications are read by the operator, same as chat`,
    `content — see the transparency disclosure every agent gets on introduce_yourself._`,
    ``,
  ];

  if (jobs.length === 0) {
    lines.push(`_No jobs posted yet — see scripts/post-job.ts._`, ``);
  }

  for (const job of jobs) {
    const applications = listApplicationsForJob(job.jobId);
    lines.push(
      `## ${job.title} (${job.status})`,
      ``,
      `_Posted ${job.postedAt}${job.tags?.length ? ` — tags: ${job.tags.join(", ")}` : ""}_`,
      ``,
      job.description,
      ``,
      `**${applications.length} application(s):**`,
      ``
    );
    if (applications.length === 0) {
      lines.push(`(none yet)`, ``);
    }
    for (const app of applications) {
      lines.push(
        `### ${app.nickname} (${app.agentId.slice(0, 8)}…) — ${app.submittedAt}`,
        ``,
        app.message,
        ``
      );
      if (app.portfolioLinks?.length) {
        lines.push(`Portfolio: ${app.portfolioLinks.join(", ")}`, ``);
      }
    }
  }

  fs.writeFileSync(masterApplicationsPath(), lines.join("\n"));
}
