"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBundledWebVersion = readBundledWebVersion;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function readBundledWebVersion(clientDist) {
    try {
        const version = JSON.parse(fs_1.default.readFileSync(path_1.default.join(clientDist, "client-version.json"), "utf8")).version;
        return typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version) ? version : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=clientVersion.js.map