/**
 * Platform/realtime composition root.
 *
 * Domain services expose dependency ports; this module is the only place that
 * wires those ports to the legacy WebSocket transport while MIG-0514 continues.
 */
import { configureStatusFanout } from "../services/status/broadcaster";
import { sendToUser } from "../utils/ws";

function composeRealtimeBoundaries(): void {
    configureStatusFanout(sendToUser);
}

export { composeRealtimeBoundaries };
