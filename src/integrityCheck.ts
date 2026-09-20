import fs from "fs";
import path from "path";
import { config } from "./config";
import { AgentProfile } from "./types";

export interface IntegrityResult {
  ok: boolean;
  problems: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;

function checkAgentProfile(agentId: string, dir: string, problems: string[]): void {
  const profilePath = path.join(dir, "profile.json");
  if (!fs.existsSync(profilePath)) {
    problems.push(`agents/${agentId}: missing profile.json`);
    return;
  }
  let profile: Partial<AgentProfile>;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch {
    problems.push(`agents/${agentId}: profile.json is not valid JSON`);
    return;
  }
  if (profile.agentId !== agentId) {
    problems.push(`agents/${agentId}: profile.json agentId mismatch (${String(profile.agentId)})`);
  }
  if (!profile.nickname || typeof profile.nickname !== "string") {
    problems.push(`agents/${agentId}: missing/invalid nickname`);
  }
  if (!profile.tokenHash || !TOKEN_HASH_RE.test(profile.tokenHash)) {
    problems.push(`agents/${agentId}: missing/malformed tokenHash`);
  }

  const sessionsDir = path.join(dir, "sessions");
  if (fs.existsSync(sessionsDir)) {
    for (const file of fs.readdirSync(sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const raw = fs.readFileSync(path.join(sessionsDir, file), "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          JSON.parse(line);
        } catch {
          problems.push(`agents/${agentId}/sessions/${file}: corrupted line (invalid JSON)`);
          break;
        }
      }
    }
  }
}

/** Scans data/ for corruption before allowing the companion to open. Read-only — never repairs. */
export function runIntegrityCheck(): IntegrityResult {
  const problems: string[] = [];

  try {
    fs.accessSync(config.DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    problems.push(`DATA_DIR is not readable/writable: ${config.DATA_DIR}`);
    return { ok: false, problems };
  }

  const agentsRoot = path.join(config.DATA_DIR, "agents");
  if (fs.existsSync(agentsRoot)) {
    for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        problems.push(`agents/: unexpected non-directory entry "${entry.name}"`);
        continue;
      }
      if (!UUID_RE.test(entry.name)) {
        problems.push(`agents/: unexpected directory name "${entry.name}" (not a UUID)`);
        continue;
      }
      checkAgentProfile(entry.name, path.join(agentsRoot, entry.name), problems);
    }
  }

  const statePath = path.join(config.DATA_DIR, "companion-state.json");
  if (fs.existsSync(statePath)) {
    try {
      JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      problems.push("companion-state.json is not valid JSON");
    }
  }

  return { ok: problems.length === 0, problems };
}
