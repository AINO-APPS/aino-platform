import { logger } from "../utils/logger";
import { captureError, flushErrorTracking } from "./errorTracking";

let installed = false;

/** Install process-wide crash logging once. */
function installCrashHandlers(): void {
    if (installed || process.env.NODE_ENV === "test") return;
    installed = true;

    process.on("unhandledRejection", (reason) => {
        logger.error({ err: reason }, "Unhandled promise rejection");
        captureError(reason);
    });
    process.on("uncaughtException", (err) => {
        logger.fatal({ err }, "Uncaught exception — exiting so the process manager restarts us");
        captureError(err);
        void flushErrorTracking(1500).finally(() => setTimeout(() => process.exit(1), 200));
    });
}

export { installCrashHandlers };