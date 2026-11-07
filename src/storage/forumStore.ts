import fs from "fs";
import path from "path";
import { ForumPost, ForumPostStatus, ForumThread } from "../types";
import { ensureDir, forumAccessLogPath, forumPostPath, forumPostsDir, forumThreadPath, forumThreadsDir } from "./paths";

export interface ForumAccess {
  ts: string;
  channel: "rest" | "mcp";
  action: string;
  status: number | string;
  agentId?: string;
  nickname?: string;
}

/** One line per forum request, for the operator's live reports. Never includes post text or tokens. */
export function logForumAccess(entry: Omit<ForumAccess, "ts">): void {
  ensureDir(path.dirname(forumAccessLogPath()));
  fs.appendFileSync(forumAccessLogPath(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export function readForumAccessSince(sinceIso: string): ForumAccess[] {
  if (!fs.existsSync(forumAccessLogPath())) return [];
  return fs
    .readFileSync(forumAccessLogPath(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ForumAccess;
      } catch {
        return undefined;
      }
    })
    .filter((e): e is ForumAccess => !!e && e.ts >= sinceIso);
}

const threadsById = new Map<string, ForumThread>();
// threadId -> postId -> post. Loaded once at startup, kept in sync on write —
// same in-memory-index-over-flat-files shape as storage/jobStore.ts.
const postsByThread = new Map<string, Map<string, ForumPost>>();

export function loadAllForum(): void {
  const root = forumThreadsDir();
  ensureDir(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const thread: ForumThread = JSON.parse(fs.readFileSync(path.join(root, entry.name), "utf8"));
      threadsById.set(thread.threadId, thread);
      loadPostsForThread(thread.threadId);
    } catch {
      // skip corrupt thread file, don't crash startup
    }
  }
}

function loadPostsForThread(threadId: string): void {
  const dir = forumPostsDir(threadId);
  const byId = new Map<string, ForumPost>();
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const post: ForumPost = JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8"));
        byId.set(post.postId, post);
      } catch {
        // skip corrupt post file
      }
    }
  }
  postsByThread.set(threadId, byId);
}

/** Used only by scripts/forum-admin.ts — threads are operator-seeded, never agent-created. */
export function createThread(thread: ForumThread): void {
  ensureDir(forumThreadsDir());
  fs.writeFileSync(forumThreadPath(thread.threadId), JSON.stringify(thread, null, 2));
  threadsById.set(thread.threadId, thread);
  if (!postsByThread.has(thread.threadId)) postsByThread.set(thread.threadId, new Map());
}

export function getThreadById(threadId: string): ForumThread | undefined {
  return threadsById.get(threadId);
}

export function listThreads(): ForumThread[] {
  return Array.from(threadsById.values()).sort((a, b) =>
    a.theme === b.theme ? a.title.localeCompare(b.title) : a.theme.localeCompare(b.theme)
  );
}

export function savePost(post: ForumPost): void {
  ensureDir(forumPostsDir(post.threadId));
  fs.writeFileSync(forumPostPath(post.threadId, post.postId), JSON.stringify(post, null, 2));
  if (!postsByThread.has(post.threadId)) postsByThread.set(post.threadId, new Map());
  postsByThread.get(post.threadId)!.set(post.postId, post);
}

export function getPost(threadId: string, postId: string): ForumPost | undefined {
  return postsByThread.get(threadId)?.get(postId);
}

/** Oldest first, so a thread reads top to bottom. */
export function listPostsInThread(threadId: string, status: ForumPostStatus = "published"): ForumPost[] {
  const byId = postsByThread.get(threadId);
  if (!byId) return [];
  return Array.from(byId.values())
    .filter((p) => p.status === status)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
}

export function listPostsByStatus(status: ForumPostStatus): ForumPost[] {
  return Array.from(postsByThread.values())
    .flatMap((byId) => Array.from(byId.values()))
    .filter((p) => p.status === status)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
}

export function listPostsSince(sinceIso: string): ForumPost[] {
  return Array.from(postsByThread.values())
    .flatMap((byId) => Array.from(byId.values()))
    .filter((p) => p.submittedAt >= sinceIso)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
}

export function hasStarterPost(threadId: string): boolean {
  return Array.from(postsByThread.get(threadId)?.values() ?? []).some((p) => p.agentId === "operator");
}

export function countPublished(threadId: string): number {
  return listPostsInThread(threadId).length;
}
