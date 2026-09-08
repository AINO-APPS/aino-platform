"use strict";
// Payload and bridge types shared by the Electron main process and the web
// renderer. This file must stay free of `electron` imports: the client CI job
// typechecks these declarations but never installs desktop dependencies, so a
// value or type import from `electron` here breaks `client && npm run typecheck`.
// Electron-coupled helpers live in `ipc-contract.ts`, which re-exports this file.
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=ipc-types.js.map