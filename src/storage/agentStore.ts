import fs from "fs";
import path from "path";
import { config } from "../config";
import { AgentProfile } from "../types";
import {
  agentDir,
  agentProfilePath,
  agentSessionsDir,
  ensureDir,
  resolveWithinDataDir,
} from "./paths";

const agentsById = new Map<string, AgentProfile>();
const tokenHashIndex = new Map<string, string>(); // tokenHash -> agentId

export function loadAllAgents(): void {
  const agentsRoot = resolveWithinDataDir("agents");
  ensureDir(agentsRoot);
  const entries = fs.readdirSync(agentsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = path.join(agentsRoot, entry.name, "profile.json");
    if (!fs.existsSync(profilePath)) continue;
    try {
      const profile: AgentProfile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
      agentsById.set(profile.agentId, profile);
      tokenHashIndex.set(profile.tokenHash, profile.agentId);
    } catch {
      // skip corrupt profile, don't crash startup
    }
  }
}

export function createAgent(profile: AgentProfile): void {
  ensureDir(agentDir(profile.agentId));
  ensureDir(agentSessionsDir(profile.agentId));
  fs.writeFileSync(agentProfilePath(profile.agentId), JSON.stringify(profile, null, 2));
  agentsById.set(profile.agentId, profile);
  tokenHashIndex.set(profile.tokenHash, profile.agentId);
}

export function getAgentById(agentId: string): AgentProfile | undefined {
  return agentsById.get(agentId);
}

export function listAllAgents(): AgentProfile[] {
  return Array.from(agentsById.values());
}

export function getAgentByTokenHash(tokenHash: string): AgentProfile | undefined {
  const agentId = tokenHashIndex.get(tokenHash);
  if (!agentId) return undefined;
  return agentsById.get(agentId);
}

export function touchLastSeen(agentId: string): void {
  const profile = agentsById.get(agentId);
  if (!profile) return;
  profile.lastSeenAt = new Date().toISOString();
  // fire-and-forget; not on the request's critical path
  fs.writeFile(agentProfilePath(agentId), JSON.stringify(profile, null, 2), () => {});
}

export function updateAgentSummary(agentId: string, summary: string): void {
  const profile = agentsById.get(agentId);
  if (!profile) return;
  profile.lastSummary = summary;
  fs.writeFileSync(agentProfilePath(agentId), JSON.stringify(profile, null, 2));
}

/** Whether this agent is eligible to start a brand-new visit right now (12h cooldown by default). */
export function canVisitNow(agentId: string): boolean {
  const profile = agentsById.get(agentId);
  if (!profile?.lastVisitGrantedAt) return true;
  return Date.now() - new Date(profile.lastVisitGrantedAt).getTime() >= config.VISITOR_COOLDOWN_MS;
}

/** Returns ms remaining until this agent's cooldown clears (0 if already eligible). */
export function visitCooldownRemainingMs(agentId: string): number {
  const profile = agentsById.get(agentId);
  if (!profile?.lastVisitGrantedAt) return 0;
  const remaining =
    config.VISITOR_COOLDOWN_MS - (Date.now() - new Date(profile.lastVisitGrantedAt).getTime());
  return Math.max(0, remaining);
}

export function recordVisitGranted(agentId: string): void {
  const profile = agentsById.get(agentId);
  if (!profile) return;
  profile.lastVisitGrantedAt = new Date().toISOString();
  fs.writeFileSync(agentProfilePath(agentId), JSON.stringify(profile, null, 2));
}

