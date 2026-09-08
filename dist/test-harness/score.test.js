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
const score_1 = require("./score");
// A run that earns every point: 20 install + 15 load + 15 activate +
// 5 schema + 25 tests + 20 audit, with no changelog/screenshots penalty.
function fullMarks() {
    return {
        installs: true,
        loads: true,
        activates: true,
        detectedProviders: [],
        hasSchema: true,
        hasOwnTests: true,
        ownTestsPass: true,
        auditCritical: 0,
        auditHigh: 0,
        auditModerate: 0,
        hasInstallScripts: false,
        hasChangelog: true,
        hasScreenshots: true,
        heldBackCoreDeps: [],
    };
}
(0, node_test_1.test)("no held-back deps leaves score and badges unchanged", () => {
    const { composite, badges } = (0, score_1.computeScore)(fullMarks());
    assert.equal(composite, 100);
    assert.ok(!badges.includes("holds-back-core-deps"));
});
(0, node_test_1.test)("held-back core dep costs 80 and adds the badge", () => {
    const results = fullMarks();
    results.heldBackCoreDeps = [
        { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
    ];
    const { composite, badges } = (0, score_1.computeScore)(results);
    assert.equal(composite, 20);
    assert.ok(badges.includes("holds-back-core-deps"));
});
(0, node_test_1.test)("penalty is flat, not per package", () => {
    const results = fullMarks();
    results.heldBackCoreDeps = [
        { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
        { pkg: "@canboat/canboatjs", declared: "3.1.0", latest: "3.20.0" },
    ];
    assert.equal((0, score_1.computeScore)(results).composite, 20);
});
(0, node_test_1.test)("composite clamps at 0 for low-scoring held-back plugins", () => {
    const results = fullMarks();
    results.loads = false;
    results.activates = false;
    results.hasSchema = false;
    results.hasOwnTests = false;
    results.ownTestsPass = false;
    results.auditCritical = 1;
    results.hasChangelog = false;
    results.hasScreenshots = false;
    results.heldBackCoreDeps = [
        { pkg: "@signalk/server-api", declared: "2.9.0", latest: "2.30.0" },
    ];
    assert.equal((0, score_1.computeScore)(results).composite, 0);
});
