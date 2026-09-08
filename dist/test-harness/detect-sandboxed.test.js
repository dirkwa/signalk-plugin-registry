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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
// These tests exercise the compiled subprocess entry the runner forks, so
// the crash handlers are tested exactly as they run in production: a plugin
// that kills the process must still leave a result file with its real error.
const SCRIPT = path.join(__dirname, "detect-sandboxed.js");
function runDetection(indexJs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-detect-crash-"));
    try {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "crash-fixture", version: "1.0.0", main: "index.js" }));
        fs.writeFileSync(path.join(dir, "index.js"), indexJs);
        const outputFile = path.join(dir, "result.json");
        const proc = (0, child_process_1.spawnSync)(process.execPath, [SCRIPT, dir, outputFile], {
            timeout: 15_000,
            encoding: "utf-8",
        });
        const result = fs.existsSync(outputFile)
            ? JSON.parse(fs.readFileSync(outputFile, "utf-8"))
            : undefined;
        return { status: proc.status, result };
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
// start() holds detection on the event loop for 100ms so the 10ms crash
// timer deterministically fires mid-detection — the bt-sensors shape, where
// a dangling import() rejected while the harness was still probing.
const UNHANDLED_REJECTION_PLUGIN = `
module.exports = function (app) {
  return {
    id: "crash-fixture",
    name: "crash fixture",
    schema: {},
    start: () => {
      setTimeout(() => { Promise.reject(new Error("fixture async boom")) }, 10)
      return new Promise((resolve) => setTimeout(resolve, 100))
    },
    stop: () => {}
  }
}
`;
const UNCAUGHT_EXCEPTION_PLUGIN = `
module.exports = function (app) {
  return {
    id: "crash-fixture",
    name: "crash fixture",
    schema: {},
    start: () => {
      setTimeout(() => { throw new Error("fixture sync boom") }, 10)
      return new Promise((resolve) => setTimeout(resolve, 100))
    },
    stop: () => {}
  }
}
`;
// Rejects with a value whose every stringification path throws — the
// crash handler must still write a result rather than dying unwritten.
const HOSTILE_VALUE_PLUGIN = `
module.exports = function (app) {
  return {
    id: "crash-fixture",
    name: "crash fixture",
    schema: {},
    start: () => {
      setTimeout(() => {
        Promise.reject({
          toString() { throw new Error("nope") },
          [Symbol.toPrimitive]() { throw new Error("nope") }
        })
      }, 10)
      return new Promise((resolve) => setTimeout(resolve, 100))
    },
    stop: () => {}
  }
}
`;
const HUGE_MESSAGE_PLUGIN = `
module.exports = function (app) {
  return {
    id: "crash-fixture",
    name: "crash fixture",
    schema: {},
    start: () => {
      setTimeout(() => { Promise.reject(new Error("x".repeat(100000))) }, 10)
      return new Promise((resolve) => setTimeout(resolve, 100))
    },
    stop: () => {}
  }
}
`;
const HEALTHY_PLUGIN = `
module.exports = function (app) {
  return {
    id: "crash-fixture",
    name: "crash fixture",
    schema: {},
    start: () => {},
    stop: () => {}
  }
}
`;
(0, node_test_1.test)("unhandled rejection mid-detection still writes a result with the real error", () => {
    const { status, result } = runDetection(UNHANDLED_REJECTION_PLUGIN);
    assert.equal(status, 1);
    assert.ok(result, "crash result file was written");
    assert.equal(result.loads, false);
    assert.equal(result.activates, false);
    assert.match(String(result.loadError), /^unhandled rejection: /);
    assert.match(String(result.loadError), /fixture async boom/);
});
(0, node_test_1.test)("uncaught exception from a plugin timer still writes a result with the real error", () => {
    const { status, result } = runDetection(UNCAUGHT_EXCEPTION_PLUGIN);
    assert.equal(status, 1);
    assert.ok(result, "crash result file was written");
    assert.equal(result.loads, false);
    assert.match(String(result.loadError), /^uncaught exception: /);
    assert.match(String(result.loadError), /fixture sync boom/);
});
(0, node_test_1.test)("a crash value that throws on stringification still yields a result", () => {
    const { status, result } = runDetection(HOSTILE_VALUE_PLUGIN);
    assert.equal(status, 1);
    assert.ok(result, "crash result file was written");
    assert.equal(result.loadError, "unhandled rejection: unprintable crash value");
});
(0, node_test_1.test)("an oversized crash message is capped before publication", () => {
    const { status, result } = runDetection(HUGE_MESSAGE_PLUGIN);
    assert.equal(status, 1);
    assert.ok(result, "crash result file was written");
    assert.ok(String(result.loadError).length <= 600, `loadError not capped: ${String(result.loadError).length} chars`);
    assert.match(String(result.loadError), /^unhandled rejection: x+/);
});
(0, node_test_1.test)("a healthy plugin is unaffected by the crash handlers", () => {
    const { status, result } = runDetection(HEALTHY_PLUGIN);
    assert.equal(status, 0);
    assert.ok(result, "result file was written");
    assert.equal(result.loads, true);
    assert.equal(result.activates, true);
    assert.equal(result.loadError, undefined);
});
