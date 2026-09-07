/**
 * Platform/realtime composition root.
 *
 * Domain services expose dependency ports; this module is the only place that
 * wires domain ports to the realtime fan-out boundary.
 */
import { configureStatusFanout } from "../services/status/broadcaster";
import { sendToUser } from "./fanout";

function composeRealtimeBoundaries(): void {
    configureStatusFanout(sendToUser);
}

export { composeRealtimeBoundaries };
