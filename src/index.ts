import http from "http";
import { config } from "./config";
import { logger } from "./logger";
import { ensureDir } from "./storage/paths";
import { loadAllAgents } from "./storage/agentStore";
import { loadAllJobs } from "./storage/jobStore";
import { loadOpenState, isOpen } from "./reception/openState";
import { startHeartbeatWatchdog } from "./reception/heartbeat";
import { createServer } from "./server";
import { attachWebSocketServer } from "./ws/server";
import { startExtractionScheduler } from "./needsExtraction/scheduler";

ensureDir(config.DATA_DIR);
loadAllAgents();
loadAllJobs();
loadOpenState();

const app = createServer();
const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);
startExtractionScheduler();
startHeartbeatWatchdog();

httpServer.listen(config.PORT, config.HOST, () => {
  logger.info(
    `${config.COMPANION_NAME} is listening on http://${config.HOST}:${config.PORT} ` +
      `(open=${isOpen()}, visit budget=${config.VISIT_TIME_BUDGET_MS}ms)`
  );
});
