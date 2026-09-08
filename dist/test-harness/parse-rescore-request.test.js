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
const parse_rescore_request_1 = require("../scripts/parse-rescore-request");
const npm_name_1 = require("../scripts/npm-name");
const resolve_single_plugin_1 = require("../scripts/resolve-single-plugin");
// The re-score request parser is the trust boundary for the on-demand path:
// everything it returns came from an issue body or a comment, both of which
// anyone can write. These cover the splitting and extraction; the npm-grammar
// and keyword gates live behind a network call and are exercised in the
// workflow itself.
(0, node_test_1.test)("splitSpecifier: a bare name has no specifier", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("signalk-my-plugin"), {
        name: "signalk-my-plugin",
        specifier: "",
    });
});
(0, node_test_1.test)("splitSpecifier: a dist-tag is separated from the name", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("signalk-my-plugin@beta"), {
        name: "signalk-my-plugin",
        specifier: "beta",
    });
});
(0, node_test_1.test)("splitSpecifier: an exact version is separated from the name", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("signalk-my-plugin@2.0.0-rc.1"), {
        name: "signalk-my-plugin",
        specifier: "2.0.0-rc.1",
    });
});
// The scope marker is an `@` at position 0, and splitting on it would leave
// the name empty and the specifier holding the whole package name.
(0, node_test_1.test)("splitSpecifier: a scoped name without a specifier stays intact", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("@signalk/tracks-plugin"), {
        name: "@signalk/tracks-plugin",
        specifier: "",
    });
});
(0, node_test_1.test)("splitSpecifier: a scoped name splits on the last @", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("@signalk/tracks-plugin@next"), {
        name: "@signalk/tracks-plugin",
        specifier: "next",
    });
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("@signalk/tracks-plugin@3.0.0-beta.0"), {
        name: "@signalk/tracks-plugin",
        specifier: "3.0.0-beta.0",
    });
});
// A trailing `@` is a typo rather than a request for a tag named "". It falls
// back to latest, which is the same thing a bare name does.
(0, node_test_1.test)("splitSpecifier: a trailing @ yields an empty specifier", () => {
    assert.deepEqual((0, parse_rescore_request_1.splitSpecifier)("signalk-my-plugin@"), {
        name: "signalk-my-plugin",
        specifier: "",
    });
});
(0, node_test_1.test)("extractFromComment: reads the name after /rescore", () => {
    assert.equal((0, parse_rescore_request_1.extractFromComment)("/rescore signalk-my-plugin"), "signalk-my-plugin");
});
(0, node_test_1.test)("extractFromComment: keeps a specifier attached to the name", () => {
    assert.equal((0, parse_rescore_request_1.extractFromComment)("/rescore @signalk/tracks-plugin@next"), "@signalk/tracks-plugin@next");
});
(0, node_test_1.test)("extractFromComment: tolerates backtick fencing", () => {
    assert.equal((0, parse_rescore_request_1.extractFromComment)("/rescore `signalk-my-plugin@beta`"), "signalk-my-plugin@beta");
});
(0, node_test_1.test)("extractFromComment: ignores a comment that is not a command", () => {
    assert.equal((0, parse_rescore_request_1.extractFromComment)("please rescore signalk-my-plugin"), "");
});
(0, node_test_1.test)("extractFromIssueBody: reads the answer under the heading", () => {
    const body = ["### npm package name", "", "signalk-my-plugin", "", "### Confirmation", "- [X] yes"].join("\n");
    assert.equal((0, parse_rescore_request_1.extractFromIssueBody)(body), "signalk-my-plugin");
});
(0, node_test_1.test)("extractFromIssueBody: keeps a specifier the author typed", () => {
    const body = "### npm package name\n\n@signalk/tracks-plugin@beta\n";
    assert.equal((0, parse_rescore_request_1.extractFromIssueBody)(body), "@signalk/tracks-plugin@beta");
});
// GitHub writes CRLF line endings on some clients; splitting on \n alone would
// leave a trailing \r on the extracted name and fail the npm-grammar gate.
(0, node_test_1.test)("extractFromIssueBody: handles CRLF line endings", () => {
    assert.equal((0, parse_rescore_request_1.extractFromIssueBody)("### npm package name\r\n\r\nsignalk-my-plugin\r\n"), "signalk-my-plugin");
});
(0, node_test_1.test)("extractFromIssueBody: returns nothing when the heading is absent", () => {
    assert.equal((0, parse_rescore_request_1.extractFromIssueBody)("just some prose"), "");
});
// A resolved version is interpolated unescaped into `npm install <name>@<v>`
// in test-harness/runner.ts, the same surface isValidNpmName fences for the
// name. It arrives either from an issue body or from a workflow_dispatch
// input, so both ends validate through here.
(0, node_test_1.test)("isExactVersion: accepts the versions npm actually publishes", () => {
    for (const v of ["1.0.0", "3.0.0-beta.0", "2.0.0-rc.1", "1.2.3+build.4", "0.0.1"]) {
        assert.equal((0, npm_name_1.isExactVersion)(v), true, v);
    }
});
(0, node_test_1.test)("isExactVersion: rejects shell metacharacters", () => {
    for (const v of [
        "1.0.0; id",
        "1.0.0 && id",
        "$(id)",
        "`id`",
        "1.0.0|tee /tmp/x",
        "1.0.0 >/tmp/x",
        "a b",
        "1.0.0\n2.0.0",
    ]) {
        assert.equal((0, npm_name_1.isExactVersion)(v), false, v);
    }
});
// A leading `-` reads as an option flag once the version reaches
// `npm install <name>@<version>`, the same reason isValidNpmName excludes it.
(0, node_test_1.test)("isExactVersion: rejects a leading dash and an empty string", () => {
    assert.equal((0, npm_name_1.isExactVersion)("--force"), false);
    assert.equal((0, npm_name_1.isExactVersion)("-1.0.0"), false);
    assert.equal((0, npm_name_1.isExactVersion)(""), false);
});
// npm's packument is parsed from a network response, so a plain `obj[key]`
// lookup reaches Object.prototype: `@constructor` resolved to
// "function Object() { [native code] }" and flowed to the shell.
(0, node_test_1.test)("isExactVersion: rejects prototype leakage", () => {
    assert.equal((0, npm_name_1.isExactVersion)("function Object() { [native code] }"), false);
    assert.equal((0, npm_name_1.isExactVersion)("[object Object]"), false);
});
(0, node_test_1.test)("isExactVersion: rejects an over-long version", () => {
    assert.equal((0, npm_name_1.isExactVersion)("1" + ".0".repeat(200)), false);
});
// The packument is parsed from a network response, so a plain `obj[key]` read
// reaches Object.prototype. `@constructor` resolved to
// "function Object() { [native code] }" and flowed into a shell command.
// The version grammar does not cover this on its own where a prototype key is
// itself version-shaped, so the own-property read is the control that rejects
// it.
(0, node_test_1.test)("own: reads only own properties", () => {
    const versions = JSON.parse('{"1.0.0": {"version": "1.0.0"}}');
    assert.deepEqual((0, parse_rescore_request_1.own)(versions, "1.0.0"), { version: "1.0.0" });
    for (const key of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
        assert.equal((0, parse_rescore_request_1.own)(versions, key), undefined, key);
    }
});
(0, node_test_1.test)("own: tolerates an absent container", () => {
    assert.equal((0, parse_rescore_request_1.own)(undefined, "1.0.0"), undefined);
});
// Anything reaching the matrix becomes a results.json key, so it must be an
// exact version. A dist-tag is alphanumeric and would pass a plain
// shell-safety check, but a run keyed on `beta` writes a slot under that name
// beside the real versions, and slots are never deleted.
(0, node_test_1.test)("isExactVersion: accepts exact npm versions", () => {
    for (const v of ["1.0.0", "3.0.0-beta.0", "2.0.0-rc.1", "1.2.3+build.4", "0.0.1", "10.20.30"]) {
        assert.equal((0, npm_name_1.isExactVersion)(v), true, v);
    }
});
// A dist-tag is alphanumeric, so a plain shell-safety check would pass it —
// but a run keyed on `beta` writes a permanent slot under that name.
(0, node_test_1.test)("isExactVersion: rejects dist-tags", () => {
    for (const tag of ["latest", "next", "beta", "alpha", "canary"]) {
        assert.equal((0, npm_name_1.isExactVersion)(tag), false, tag);
    }
});
(0, node_test_1.test)("isExactVersion: rejects partial and malformed versions", () => {
    for (const v of ["1.0", "1", "v1.0.0", "1.0.0.0", "", "1.0.0 ", "^1.0.0", "~1.0.0"]) {
        assert.equal((0, npm_name_1.isExactVersion)(v), false, JSON.stringify(v));
    }
});
(0, node_test_1.test)("isExactVersion: rejects shell metacharacters", () => {
    for (const v of ["1.0.0; id", "$(id)", "`id`", "1.0.0 && id"]) {
        assert.equal((0, npm_name_1.isExactVersion)(v), false, v);
    }
});
// The version gate in resolve-single-plugin: what may reach the matrix once a
// dispatch names an explicit version.
(0, node_test_1.test)("versionRejection: accepts a published exact version", () => {
    const versions = JSON.parse('{"2.1.0": {}, "3.0.0-beta.0": {}}');
    assert.equal((0, resolve_single_plugin_1.versionRejection)("pkg", "2.1.0", versions), undefined);
    assert.equal((0, resolve_single_plugin_1.versionRejection)("pkg", "3.0.0-beta.0", versions), undefined);
});
// Shaped like a version but npm does not have it: the install fails and a
// scored slot is still written under that key, permanently.
(0, node_test_1.test)("versionRejection: rejects an unpublished version", () => {
    const versions = JSON.parse('{"2.1.0": {}}');
    assert.match((0, resolve_single_plugin_1.versionRejection)("pkg", "99.99.99", versions) ?? "", /not published/);
});
(0, node_test_1.test)("versionRejection: rejects a dist-tag", () => {
    const versions = JSON.parse('{"2.1.0": {}}');
    assert.match((0, resolve_single_plugin_1.versionRejection)("pkg", "beta", versions) ?? "", /Not an exact/);
});
// `versions` is parsed from a network response, so a plain lookup reaches
// Object.prototype and every prototype key reads as published.
//
// Prototype *names* are caught earlier by isExactVersion — they are not shaped
// like versions — so testing those alone passes whether or not the read is an
// own-property one. `valueOf` on a fresh object is the same hazard reached by a
// value that IS version-shaped: npm allows a version to be missing from the map
// while the prototype still answers for it, so the published check has to be an
// own-property read to mean anything.
(0, node_test_1.test)("versionRejection: rejects prototype keys that look like versions", () => {
    const versions = JSON.parse('{"2.1.0": {}}');
    // Shaped like a version, absent from the map, but present on the prototype
    // chain of any object once someone extends it — which a plain lookup honours.
    Object.defineProperty(Object.prototype, "9.9.9", {
        value: { poisoned: true },
        configurable: true,
        enumerable: false,
    });
    try {
        assert.match((0, resolve_single_plugin_1.versionRejection)("pkg", "9.9.9", versions) ?? "", /not published/);
    }
    finally {
        delete Object.prototype["9.9.9"];
    }
});
(0, node_test_1.test)("versionRejection: rejects prototype method names outright", () => {
    const versions = JSON.parse('{"2.1.0": {}}');
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
        assert.notEqual((0, resolve_single_plugin_1.versionRejection)("pkg", key, versions), undefined, key);
    }
});
(0, node_test_1.test)("versionRejection: rejects when the packument carries no versions", () => {
    assert.notEqual((0, resolve_single_plugin_1.versionRejection)("pkg", "1.0.0", undefined), undefined);
});
