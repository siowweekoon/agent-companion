/**
 * The forum is closed unless a live window is open. Only scripts/forum-live.ts opens one (default
 * 30 minutes) and it stops the whole server when the window ends, so outside a window nothing is
 * received or sent. A normal `npm start`/`npm run dev` never opens the forum: its routes answer
 * 503 with no data, and its MCP tools are not even registered.
 */
let liveUntil = 0;

export function openForumWindow(minutes: number): Date {
  liveUntil = Date.now() + minutes * 60_000;
  return new Date(liveUntil);
}

export function closeForumWindow(): void {
  liveUntil = 0;
}

export function isForumLive(): boolean {
  return Date.now() < liveUntil;
}

export function forumMsLeft(): number {
  return Math.max(0, liveUntil - Date.now());
}
