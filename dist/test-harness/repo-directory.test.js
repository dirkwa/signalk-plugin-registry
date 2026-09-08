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
const repo_directory_1 = require("./repo-directory");
// The values real registry plugins publish today.
const REAL_WORLD = [
    "signalk-plugin", // signalk-aiscast
    "packages/resources-provider-plugin", // @signalk/resources-provider
    "cerbo/telltale-signalk-plugin", // signalk-telltale-plugin
    "consumer-plugin", // signalk-victron-ble-consumer
];
(0, node_test_1.test)("accepts the directory values real plugins publish", () => {
    for (const value of REAL_WORLD) {
        assert.equal((0, repo_directory_1.sanitizeRepoDirectory)(value), value);
    }
});
(0, node_test_1.test)("normalises a leading ./ and a trailing slash", () => {
    assert.equal((0, repo_directory_1.sanitizeRepoDirectory)("./sub"), "sub");
    assert.equal((0, repo_directory_1.sanitizeRepoDirectory)("sub/"), "sub");
    assert.equal((0, repo_directory_1.sanitizeRepoDirectory)("  sub  "), "sub");
});
// Proves the traversal check splits on segments instead of scanning for the
// substring "..", which would wrongly reject this legitimate directory name.
(0, node_test_1.test)("accepts a directory name that merely contains dots", () => {
    assert.equal((0, repo_directory_1.sanitizeRepoDirectory)("foo..bar"), "foo..bar");
});
(0, node_test_1.test)("rejects path traversal and absolute paths", () => {
    for (const value of ["..", "../x", "a/../../b", "/etc", "a//b", ".", "./"]) {
        assert.equal((0, repo_directory_1.sanitizeRepoDirectory)(value), null, value);
    }
});
(0, node_test_1.test)("rejects shell metacharacters and other unsafe input", () => {
    const unsafe = [
        "a`whoami`",
        "a;rm -rf /",
        "a b",
        "a|b",
        "a$b",
        "a\\b",
        "~/x",
        "a\u0000b",
        "pkg\nrm",
        "C:\\x",
        "ünïcode",
        "a*b",
        "x".repeat(300),
        "",
        "   ",
    ];
    for (const value of unsafe) {
        assert.equal((0, repo_directory_1.sanitizeRepoDirectory)(value), null, JSON.stringify(value));
    }
});
// npm metadata is arbitrary JSON: the field need not be a string at all.
(0, node_test_1.test)("rejects non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["a"], true]) {
        assert.equal((0, repo_directory_1.sanitizeRepoDirectory)(value), null, String(value));
    }
});
function withClone(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-repo-dir-"));
    try {
        run(fs.realpathSync(dir));
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
(0, node_test_1.test)("resolves a subdirectory that exists inside the clone", () => {
    withClone((dir) => {
        fs.mkdirSync(path.join(dir, "packages", "plug"), { recursive: true });
        assert.equal((0, repo_directory_1.resolveWithinClone)(dir, "packages/plug"), path.join(dir, "packages", "plug"));
    });
});
(0, node_test_1.test)("returns null when the subdirectory is absent from the clone", () => {
    withClone((dir) => {
        assert.equal((0, repo_directory_1.resolveWithinClone)(dir, "not-here"), null);
    });
});
// Defence in depth: even a symlink inside the clone must not escape it.
(0, node_test_1.test)("returns null for a symlink pointing outside the clone", () => {
    withClone((dir) => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "sk-outside-"));
        try {
            fs.symlinkSync(outside, path.join(dir, "escape"));
            assert.equal((0, repo_directory_1.resolveWithinClone)(dir, "escape"), null);
        }
        finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
// Mirrors what `npm install` leaves behind for a workspace: the dependencies
// hoist to the root and the package is linked back in by name. Note the
// workspace package has no node_modules of its own — that is precisely why
// the link, and not a node_modules check, is the discriminator.
(0, node_test_1.test)("detects a subdirectory that is a real npm workspace", () => {
    withClone((dir) => {
        const pkgDir = path.join(dir, "packages", "plug");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "plug", version: "1.0.0" }));
        fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
        fs.symlinkSync(pkgDir, path.join(dir, "node_modules", "plug"));
        assert.equal((0, repo_directory_1.isWorkspaceLinked)(dir, pkgDir), true);
    });
});
(0, node_test_1.test)("does not treat an unlinked subdirectory as a workspace", () => {
    withClone((dir) => {
        const pkgDir = path.join(dir, "sub");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "sub", version: "1.0.0" }));
        // The root install ran but never linked this package back in.
        fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
        assert.equal((0, repo_directory_1.isWorkspaceLinked)(dir, pkgDir), false);
    });
});
// A same-named package pulled from the registry is not this subdirectory.
(0, node_test_1.test)("does not mistake a real dependency of the same name for a workspace link", () => {
    withClone((dir) => {
        const pkgDir = path.join(dir, "sub");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "sub", version: "1.0.0" }));
        const installed = path.join(dir, "node_modules", "sub");
        fs.mkdirSync(installed, { recursive: true });
        assert.equal((0, repo_directory_1.isWorkspaceLinked)(dir, pkgDir), false);
    });
});
