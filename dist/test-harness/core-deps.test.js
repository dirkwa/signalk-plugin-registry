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
const core_deps_1 = require("./core-deps");
const LATEST = {
    "@signalk/server-api": "2.30.0",
    "@canboat/canboatjs": "3.20.0",
};
function check(range, pkg = "@signalk/server-api") {
    return (0, core_deps_1.findHeldBackCoreDeps)([{ pkg, range }], LATEST);
}
(0, node_test_1.test)("tilde range below latest same-major is flagged", () => {
    assert.deepEqual(check("~2.9.0"), [
        { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
    ]);
});
(0, node_test_1.test)("exact pin below latest same-major is flagged", () => {
    assert.equal(check("2.9.0").length, 1);
});
(0, node_test_1.test)("caret range that reaches latest is not flagged", () => {
    assert.deepEqual(check("^2.9.0"), []);
});
(0, node_test_1.test)("range on an older major is not flagged", () => {
    assert.deepEqual(check("^1.0.0"), []);
});
(0, node_test_1.test)("upper-bounded range starting below the latest major is not flagged", () => {
    assert.deepEqual(check("<2.10.0"), []);
});
(0, node_test_1.test)("wildcard, empty, and dist-tag ranges are skipped", () => {
    for (const range of ["*", "", "latest", "beta"]) {
        assert.deepEqual(check(range), [], `range: ${JSON.stringify(range)}`);
    }
});
(0, node_test_1.test)("non-registry specs are skipped", () => {
    for (const range of [
        "github:owner/repo",
        "git+https://github.com/owner/repo.git",
        "git://github.com/owner/repo.git",
        "file:../local",
        "link:../local",
        "workspace:^",
        "https://example.com/pkg.tgz",
        "owner/repo",
    ]) {
        assert.deepEqual(check(range), [], `range: ${range}`);
    }
});
(0, node_test_1.test)("package with no latest lookup result is skipped", () => {
    assert.deepEqual((0, core_deps_1.findHeldBackCoreDeps)([{ pkg: "@signalk/streams", range: "~6.0.0" }], LATEST), []);
});
(0, node_test_1.test)("non-core packages are not the module's concern", () => {
    // findHeldBackCoreDeps trusts its caller to pre-filter to CORE_PACKAGES,
    // but an unknown package never has a latest entry, so it is skipped.
    assert.deepEqual((0, core_deps_1.findHeldBackCoreDeps)([{ pkg: "lodash", range: "~4.17.0" }], LATEST), []);
});
(0, node_test_1.test)("first-seen range wins when a package is declared twice", () => {
    const result = (0, core_deps_1.findHeldBackCoreDeps)([
        { pkg: "@signalk/server-api", range: "~2.9.0" },
        { pkg: "@signalk/server-api", range: "~2.8.0" },
    ], LATEST);
    assert.deepEqual(result, [
        { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
    ]);
});
(0, node_test_1.test)("multiple held-back core packages each get an entry", () => {
    const result = (0, core_deps_1.findHeldBackCoreDeps)([
        { pkg: "@signalk/server-api", range: "2.9.0" },
        { pkg: "@canboat/canboatjs", range: "~3.1.0" },
    ], LATEST);
    assert.equal(result.length, 2);
});
