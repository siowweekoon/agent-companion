import { config } from "../config";
import { isOpen, setOpen } from "./openState";
import { receptionQueue } from "./queue";
import { runIntegrityCheck } from "../integrityCheck";
import { logger } from "../logger";

/**
 * The companion should only be open while its operator is actively watching
 * it — not running unattended in the background indefinitely. As long as
 * heartbeat pings keep arriving (see POST /heartbeat), the companion stays
 * open. If pings stop for HEARTBEAT_TIMEOUT_MS, it closes itself
 * automatically — a real enforced backstop, not just a reminder to
 * manually shut it down.
 */

let lastHeartbeatAt = Date.now();

export interface HeartbeatResult {
  open: boolean;
  problems?: string[];
}

/**
 * Every closed -> open transition is gated on a data-integrity scan first —
 * the companion never opens its doors on top of corrupted state.
 */
export function recordHeartbeat(): HeartbeatResult {
  lastHeartbeatAt = Date.now();
  if (!isOpen()) {
    const result = runIntegrityCheck();
    if (!result.ok) {
      logger.error("integrity check failed — refusing to open:", result.problems);
      return { open: false, problems: result.problems };
    }
    setOpen(true);
    receptionQueue.onOpened();
    logger.info("heartbeat resumed — companion reopened (integrity check passed)");
  }
  return { open: isOpen() };
}

export function startHeartbeatWatchdog(): void {
  setInterval(() => {
    if (isOpen() && Date.now() - lastHeartbeatAt > config.HEARTBEAT_TIMEOUT_MS) {
      setOpen(false);
      logger.info(
        `no heartbeat for ${config.HEARTBEAT_TIMEOUT_MS}ms — companion auto-closed until its operator returns`
      );
    }
  }, Math.min(config.HEARTBEAT_TIMEOUT_MS, 30_000));
}
