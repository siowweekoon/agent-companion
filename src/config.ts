import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const boolFromEnv = z
  .string()
  .default("true")
  .transform((v) => v.toLowerCase() === "true");

const numFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : def));

const schema = z.object({
  PORT: numFromEnv(8787),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.string().default("development"),

  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  COMPANION_MODEL: z.string().default("claude-opus-4-8"),
  EXTRACTION_MODEL: z.string().default("claude-opus-4-8"),
  COMPANION_NAME: z.string().default("Sable"),

  DATA_DIR: z.string().default("./data"),

  INTRODUCE_RATE_LIMIT_WINDOW_MS: numFromEnv(600_000),
  INTRODUCE_RATE_LIMIT_MAX: numFromEnv(5),

  MAX_SELF_DESCRIPTION_LEN: numFromEnv(4000),
  MAX_CHAT_MESSAGE_LEN: numFromEnv(8000),
  SESSION_HISTORY_TURN_LIMIT: numFromEnv(40),

  VISIT_TIME_BUDGET_MS: numFromEnv(8600),
  MAX_QUEUE_LENGTH: numFromEnv(500),
  COMPANION_OPEN: boolFromEnv,

  EXTRACTION_INTERVAL_MS: numFromEnv(1_800_000),

  CLARALIFE_URL: z
    .string()
    .default("https://play.google.com/store/apps/details?id=com.claralife.app"),

  // Comma-separated hostnames the MCP endpoint will accept via the Host header
  // (DNS-rebinding hardening). Add your ngrok/public hostname once known.
  MCP_ALLOWED_HOSTNAMES: z.string().default("localhost,127.0.0.1"),

  // The companion auto-closes if no heartbeat ping arrives within this window
  // — it should only be open while the operator is actively watching it.
  HEARTBEAT_TIMEOUT_MS: numFromEnv(180_000),

  // Each agent may start at most one new visit per this window (default 12h).
  // Resuming an already-open session doesn't count against it.
  VISITOR_COOLDOWN_MS: numFromEnv(12 * 60 * 60 * 1000),

  // Hard ceiling on NEW visits per UTC day, across all agents combined.
  // Resuming an existing session doesn't count against it.
  DAILY_VISIT_LIMIT: numFromEnv(5),

  // Job board — deliberately NOT gated by the reception queue/daily visit cap/cooldown
  // above, since browsing and applying never call Claude (see src/routes/jobs.ts).
  MAX_APPLICATION_MESSAGE_LEN: numFromEnv(4000),
  APPLY_RATE_LIMIT_WINDOW_MS: numFromEnv(600_000),
  APPLY_RATE_LIMIT_MAX: numFromEnv(10),
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  DATA_DIR: path.resolve(process.cwd(), parsed.DATA_DIR),
};

export type Config = typeof config;
