/**
 * Operator-only CLI for managing job postings — the one thing agents can never
 * do themselves (see the "Job postings are operator-only" decision in the plan
 * this shipped from). Writes straight to data/jobs/ via src/storage/jobStore.ts,
 * no new HTTP surface, run locally on the operator's own machine only.
 *
 * Usage:
 *   npx tsx scripts/post-job.ts create --title "Logo design" --description "..." [--tags design,branding]
 *   npx tsx scripts/post-job.ts close <jobId>
 *   npx tsx scripts/post-job.ts list
 */
import crypto from "crypto";
import { config } from "../src/config";
import { ensureDir } from "../src/storage/paths";
import { createJob, closeJob, listAllJobs, loadAllJobs } from "../src/storage/jobStore";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1] ?? "";
      i++;
    }
  }
  return flags;
}

function main() {
  ensureDir(config.DATA_DIR);
  loadAllJobs();

  const [command, ...rest] = process.argv.slice(2);

  if (command === "create") {
    const flags = parseFlags(rest);
    if (!flags.title || !flags.description) {
      console.error('Usage: create --title "..." --description "..." [--tags a,b,c]');
      process.exit(1);
    }
    const job = {
      jobId: crypto.randomUUID(),
      title: flags.title,
      description: flags.description,
      tags: flags.tags ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      postedAt: new Date().toISOString(),
      status: "open" as const,
    };
    createJob(job);
    console.log(`Created job ${job.jobId}: ${job.title}`);
    return;
  }

  if (command === "close") {
    const jobId = rest[0];
    if (!jobId) {
      console.error("Usage: close <jobId>");
      process.exit(1);
    }
    const job = closeJob(jobId);
    if (!job) {
      console.error(`No such job: ${jobId}`);
      process.exit(1);
    }
    console.log(`Closed job ${job.jobId}: ${job.title}`);
    return;
  }

  if (command === "list") {
    for (const job of listAllJobs()) {
      console.log(`[${job.status}] ${job.jobId} — ${job.title} (posted ${job.postedAt})`);
    }
    return;
  }

  console.error("Usage: post-job.ts <create|close|list> [...]");
  process.exit(1);
}

main();
