export {};

const configureStatusFanout = jest.fn();
const sendToUser = jest.fn();

jest.mock("../services/status/broadcaster", () => ({ configureStatusFanout }));
jest.mock("../utils/ws", () => ({ sendToUser }));

import { composeRealtimeBoundaries } from "../realtime/composition";

describe("realtime composition", () => {
    test("injects the cross-instance WebSocket fan-out into status broadcasting", () => {
        composeRealtimeBoundaries();

        expect(configureStatusFanout).toHaveBeenCalledTimes(1);
        expect(configureStatusFanout).toHaveBeenCalledWith(sendToUser);
    });
});
