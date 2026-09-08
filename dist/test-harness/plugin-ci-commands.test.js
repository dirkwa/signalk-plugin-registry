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
const plugin_ci_commands_1 = require("./plugin-ci-commands");
function withWorkflows(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-ci-cmd-"));
    try {
        const wf = path.join(dir, ".github", "workflows");
        fs.mkdirSync(wf, { recursive: true });
        for (const [name, content] of Object.entries(files)) {
            fs.writeFileSync(path.join(wf, name), content);
        }
        return (0, plugin_ci_commands_1.parseDeclaredCiCommands)(dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
// The concrete Freeboard-SK case from issue #48.
const FREEBOARD_CI = `name: SignalK Plugin CI

on:
  push:
    branches: [main, master]

jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: 'npm run build:all'
      test-command: 'npm run test:ci'
      format-check-command: 'npm run format:check'
`;
(0, node_test_1.test)("reads declared build and test commands (Freeboard-SK case)", () => {
    assert.deepEqual(withWorkflows({ "ci.yml": FREEBOARD_CI }), {
        build: "npm run build:all",
        test: "npm run test:ci",
    });
});
(0, node_test_1.test)("handles double-quoted and bare scalar values", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: "npm run build"
      test-command: npm run test:ci
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {
        build: "npm run build",
        test: "npm run test:ci",
    });
});
(0, node_test_1.test)("matches the reusable path case-insensitively and ignores the @ref", () => {
    const wf = `jobs:
  ci:
    uses: signalk/SignalK-Server/.github/workflows/plugin-ci.yml@v2
    with:
      test-command: 'npm run t'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), { test: "npm run t" });
});
(0, node_test_1.test)("returns empty when only one command is declared", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: 'npm run build:all'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {
        build: "npm run build:all",
    });
});
(0, node_test_1.test)("ignores a workflow that doesn't call the reusable plugin-ci", () => {
    const wf = `jobs:
  test:
    uses: actions/some-other-workflow.yml@v1
    with:
      build-command: 'npm run nope'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {});
});
(0, node_test_1.test)("does not pick up a with: block from an unrelated later job", () => {
    const wf = `jobs:
  lint:
    uses: actions/other.yml@v1
    with:
      build-command: 'should-not-be-read'
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      test-command: 'npm run test:ci'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), { test: "npm run test:ci" });
});
(0, node_test_1.test)("finds the caller job across multiple workflow files", () => {
    const other = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    const ci = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: 'npm run build:all'
      test-command: 'npm run test:ci'
`;
    assert.deepEqual(withWorkflows({ "release.yml": other, "ci.yml": ci }), {
        build: "npm run build:all",
        test: "npm run test:ci",
    });
});
(0, node_test_1.test)("no .github/workflows directory yields empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-ci-cmd-none-"));
    try {
        assert.deepEqual((0, plugin_ci_commands_1.parseDeclaredCiCommands)(dir), {});
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)("rejects a command with shell metacharacters", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: 'npm run build && curl evil.example'
      test-command: 'npm run test:ci'
`;
    // The build-command is dropped (metachars); the clean test-command survives.
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), { test: "npm run test:ci" });
});
(0, node_test_1.test)("rejects commands that aren't an npm-script invocation", () => {
    // No metacharacters, but neither is a plain `npm run <script>` call: a bare
    // program, and `npm install` (whose lifecycle scripts would sidestep the
    // --ignore-scripts install boundary).
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: 'npm install'
      test-command: 'curl evil.example'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {});
});
(0, node_test_1.test)("accepts the run-script alias", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      test-command: 'npm run-script test:ci'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {
        test: "npm run-script test:ci",
    });
});
(0, node_test_1.test)("rejects a YAML flow-sequence value (parses to a literal string)", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      build-command: [npm, run, build]
      test-command: 'npm run test:ci'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), { test: "npm run test:ci" });
});
(0, node_test_1.test)("reads commands when with: precedes uses: (YAML order isn't semantic)", () => {
    const wf = `jobs:
  test:
    with:
      build-command: 'npm run build:all'
      test-command: 'npm run test:ci'
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {
        build: "npm run build:all",
        test: "npm run test:ci",
    });
});
(0, node_test_1.test)("skips commented-out command lines", () => {
    const wf = `jobs:
  test:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      # build-command: 'npm run old'
      build-command: 'npm run build:all'
`;
    assert.deepEqual(withWorkflows({ "ci.yml": wf }), {
        build: "npm run build:all",
    });
});
