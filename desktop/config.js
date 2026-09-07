"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2_ORIGIN_PATTERN = exports.DEFAULT_API_SERVER = void 0;
exports.createDesktopConfig = createDesktopConfig;
const path_1 = __importDefault(require("path"));
exports.DEFAULT_API_SERVER = "https://www.aino.org.in";
exports.R2_ORIGIN_PATTERN = "https://*.r2.cloudflarestorage.com";
function createDesktopConfig(options) {
    return {
        apiServer: options.apiServer || exports.DEFAULT_API_SERVER,
        clientDist: options.isPackaged
            ? path_1.default.join(options.resourcesPath, "client", "dist")
            : path_1.default.join(options.dirname, "..", "client", "dist"),
        windowStateFile: path_1.default.join(options.userData, "window-state.json"),
        versionFile: path_1.default.join(options.userData, "last-version.txt"),
    };
}
//# sourceMappingURL=config.js.map