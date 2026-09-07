"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribe = subscribe;
function subscribe(transport, channel, callback, transform) {
    const handler = (_event, ...rawArgs) => {
        const args = rawArgs;
        callback(transform ? transform(...args) : args[0]);
    };
    transport.on(channel, handler);
    let subscribed = true;
    return () => {
        if (!subscribed)
            return;
        subscribed = false;
        transport.removeListener(channel, handler);
    };
}
//# sourceMappingURL=preloadListeners.js.map