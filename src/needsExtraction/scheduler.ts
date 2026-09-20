import { config } from "../config";
import { sweepAllSessions, triggerSessionExtraction } from "./runner";
import { logger } from "../logger";

export { triggerSessionExtraction };

export function startExtractionScheduler(): void {
  setInterval(() => {
    try {
      sweepAllSessions();
    } catch (err) {
      logger.error("extraction sweep failed:", err);
    }
  }, config.EXTRACTION_INTERVAL_MS);
}
