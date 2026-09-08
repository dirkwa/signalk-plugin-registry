"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const detect_providers_1 = require("./detect-providers");
const pluginPath = process.argv[2];
const outputFile = process.argv[3];
if (!pluginPath || !outputFile) {
    console.error("Usage: node detect-sandboxed.js <plugin-path> <output-file>");
    process.exit(1);
}
// A plugin can kill this process outside the detection promise chain — a
// dangling import() in a constructor's .then(), a timer callback that
// throws after start() returned. Without these handlers the process dies
// before writing its result file, and the runner can only report the
// generic "sandboxed detection failed". Writing a crash result here puts
// the plugin's real error into the published record instead.
function crashResult(kind, err) {
    // The crash value is plugin-controlled: stringifying it can throw
    // (hostile toString/getters) and its length is unbounded, but it flows
    // into the published record — so guard the conversion and cap the size.
    let msg;
    try {
        msg = (err instanceof Error ? String(err.message) : String(err)).slice(0, 500);
    }
    catch {
        msg = "unprintable crash value";
    }
    return {
        pluginId: path.basename(pluginPath),
        pluginName: path.basename(pluginPath),
        providers: [],
        putHandlers: [],
        httpRoutes: [],
        unstubbedAccesses: [],
        loads: false,
        loadError: `${kind}: ${msg}`,
        activates: false,
        activatesWithoutConfig: false,
        statusMessages: [],
        errorMessages: [],
        hasSchema: false,
    };
}
function dieWith(kind) {
    return (err) => {
        // The result file is the payload — write it before anything that could
        // conceivably throw. A throw inside an uncaughtException listener
        // aborts the process with nothing written.
        const result = crashResult(kind, err);
        try {
            fs.writeFileSync(outputFile, JSON.stringify(result));
        }
        catch { }
        try {
            console.error(`[detect-sandboxed] ${result.loadError}`);
        }
        catch { }
        process.exit(1);
    };
}
process.on("uncaughtException", dieWith("uncaught exception"));
process.on("unhandledRejection", dieWith("unhandled rejection"));
(0, detect_providers_1.detectProviders)(pluginPath)
    .then((result) => {
    fs.writeFileSync(outputFile, JSON.stringify(result));
    process.exit(0);
})
    .catch(dieWith("detection failed"));
