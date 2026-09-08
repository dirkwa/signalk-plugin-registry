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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const detect_providers_1 = require("./detect-providers");
async function detectFixture(indexJs, serverPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-apppath-"));
    const prior = process.env.SIGNALK_SERVER_PATH;
    try {
        if (serverPath === undefined)
            delete process.env.SIGNALK_SERVER_PATH;
        else
            process.env.SIGNALK_SERVER_PATH = serverPath;
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "apppath-fixture", version: "1.0.0", main: "index.js" }));
        fs.writeFileSync(path.join(dir, "index.js"), indexJs);
        return await (0, detect_providers_1.detectProviders)(dir);
    }
    finally {
        if (prior === undefined)
            delete process.env.SIGNALK_SERVER_PATH;
        else
            process.env.SIGNALK_SERVER_PATH = prior;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
// The bt-sensors pattern: server internals resolved by string-concatenating
// against app.config.appPath, relying on its trailing separator.
const INTERNALS_CONSUMER_PLUGIN = `
const fs = require("fs")
module.exports = function (app) {
  return {
    id: "apppath-fixture",
    name: "apppath fixture",
    schema: {},
    start: () => {
      const marker = app.config.appPath + "dist" + "/marker.js"
      if (require(marker).ok !== true) throw new Error("bad marker at " + marker)
    },
    stop: () => {}
  }
}
`;
const FALLBACK_PLUGIN = `
const fs = require("fs")
module.exports = function (app) {
  return {
    id: "apppath-fixture",
    name: "apppath fixture",
    schema: {},
    start: () => {
      if (!fs.existsSync(app.config.appPath)) {
        throw new Error("appPath does not exist: " + app.config.appPath)
      }
      if (!app.config.appPath.endsWith(require("path").sep)) {
        throw new Error("appPath lost its trailing separator: " + app.config.appPath)
      }
    },
    stop: () => {}
  }
}
`;
(0, node_test_1.test)("SIGNALK_SERVER_PATH becomes appPath with a trailing separator", async () => {
    const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-fake-server-"));
    try {
        fs.mkdirSync(path.join(serverDir, "dist"));
        fs.writeFileSync(path.join(serverDir, "dist", "marker.js"), "module.exports = { ok: true }");
        const result = await detectFixture(INTERNALS_CONSUMER_PLUGIN, serverDir);
        assert.equal(result.loads, true);
        assert.equal(result.activates, true, result.activationError);
    }
    finally {
        fs.rmSync(serverDir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)("without SIGNALK_SERVER_PATH the appPath tmpdir fallback still exists", async () => {
    const result = await detectFixture(FALLBACK_PLUGIN, undefined);
    assert.equal(result.activates, true, result.activationError);
});
(0, node_test_1.test)("a non-existent SIGNALK_SERVER_PATH falls back to the tmpdir", async () => {
    const result = await detectFixture(FALLBACK_PLUGIN, "/nonexistent/sk-server-path");
    assert.equal(result.activates, true, result.activationError);
});
