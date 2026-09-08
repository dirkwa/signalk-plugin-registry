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
async function detectFixture(indexJs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-ble-shim-"));
    try {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "ble-fixture", version: "1.0.0", main: "index.js" }));
        fs.writeFileSync(path.join(dir, "index.js"), indexJs);
        return await (0, detect_providers_1.detectProviders)(dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
const PROVIDER_PLUGIN = `
module.exports = function (app) {
  return {
    id: "ble-fixture",
    name: "ble fixture",
    schema: {},
    start: () => {
      app.registerBLEProvider({ name: "fixture provider", methods: {} })
    },
    stop: () => {}
  }
}
`;
const API_REGISTER_PLUGIN = `
module.exports = function (app) {
  return {
    id: "ble-fixture",
    name: "ble fixture",
    schema: {},
    start: () => {
      app.bleApi.register("ble-fixture", { name: "fixture provider", methods: {} })
    },
    stop: () => {}
  }
}
`;
// The consumer shape from bt-sensors-plugin-sk PR #137: feature-detect the
// API, subscribe to advertisements in start(), unsubscribe in stop().
const CONSUMER_PLUGIN = `
module.exports = function (app) {
  let unsubscribe
  return {
    id: "ble-fixture",
    name: "ble fixture",
    schema: {},
    start: () => {
      const available = app.bleApi && typeof app.bleApi.onAdvertisement === "function"
      if (!available) throw new Error("BLE API not detected")
      if (app.bleApi.localBluetoothManaged !== false) {
        throw new Error("localBluetoothManaged should be false in the harness")
      }
      unsubscribe = app.bleApi.onAdvertisement("ble-fixture", () => {})
    },
    stop: () => {
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }
}
`;
// Calls a rejecting GATT stub without await or .catch. The dangling
// rejection must not surface as an unhandled rejection — in production
// that would kill the detection subprocess (detect-sandboxed.ts treats
// those as fatal) and mislabel a loaded plugin as loads: false; in this
// in-process test it would kill the test run itself.
const FIRE_AND_FORGET_PLUGIN = `
module.exports = function (app) {
  return {
    id: "ble-fixture",
    name: "ble fixture",
    schema: {},
    start: () => {
      app.bleApi.connectGATT("aa:bb:cc:dd:ee:ff", "ble-fixture")
    },
    stop: () => {}
  }
}
`;
const GATT_CONSUMER_PLUGIN = `
module.exports = function (app) {
  return {
    id: "ble-fixture",
    name: "ble fixture",
    schema: {},
    start: async () => {
      await app.bleApi.connectGATT("aa:bb:cc:dd:ee:ff", "ble-fixture")
    },
    stop: () => {}
  }
}
`;
(0, node_test_1.test)("registerBLEProvider is captured as a ble provider", async () => {
    const result = await detectFixture(PROVIDER_PLUGIN);
    assert.equal(result.loads, true);
    assert.equal(result.activates, true);
    assert.ok(result.providers.includes("ble"), `providers: ${result.providers}`);
    assert.ok(!result.unstubbedAccesses.includes("registerBLEProvider"));
});
(0, node_test_1.test)("bleApi.register is captured as a ble provider", async () => {
    const result = await detectFixture(API_REGISTER_PLUGIN);
    assert.equal(result.activates, true);
    assert.ok(result.providers.includes("ble"), `providers: ${result.providers}`);
});
(0, node_test_1.test)("a BLE consumer activates against the stubbed API", async () => {
    const result = await detectFixture(CONSUMER_PLUGIN);
    assert.equal(result.loads, true);
    assert.equal(result.activates, true, result.activationError);
    assert.ok(!result.unstubbedAccesses.includes("bleApi"));
    assert.deepEqual(result.providers, []);
});
(0, node_test_1.test)("a fire-and-forget GATT call cannot kill detection", async () => {
    const result = await detectFixture(FIRE_AND_FORGET_PLUGIN);
    assert.equal(result.loads, true);
    assert.equal(result.activates, true, result.activationError);
});
(0, node_test_1.test)("GATT calls fail on the plugin's terms with upstream's no-provider error", async () => {
    const result = await detectFixture(GATT_CONSUMER_PLUGIN);
    assert.equal(result.loads, true);
    assert.equal(result.activates, false);
    assert.match(String(result.activationError), /No provider with GATT support can see aa:bb:cc:dd:ee:ff/);
});
