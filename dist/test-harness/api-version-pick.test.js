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
const npm_name_1 = require("../scripts/npm-name");
const build_api_1 = require("../scripts/build-api");
// The real function build-api.ts uses, imported rather than reimplemented — a
// copy here would pass while the page did something else.
(0, node_test_1.test)("isPrerelease: identifies pre-release versions", () => {
    for (const v of ["3.0.0-beta.0", "1.0.0-alpha.1", "2.0.0-rc.1", "1.2.3-next.4"]) {
        assert.equal((0, npm_name_1.isPrerelease)(v), true, v);
    }
    for (const v of ["1.0.0", "2.1.0", "10.20.30", "1.2.3+build.4"]) {
        assert.equal((0, npm_name_1.isPrerelease)(v), false, v);
    }
});
// SemVer puts build metadata after `+` and the pre-release tag before it, so a
// hyphen in the metadata does not make a release a pre-release.
(0, node_test_1.test)("isPrerelease: ignores a hyphen inside build metadata", () => {
    assert.equal((0, npm_name_1.isPrerelease)("1.2.3+build-meta"), false);
    assert.equal((0, npm_name_1.isPrerelease)("1.2.3+sha-abc123"), false);
    // Both parts present: the pre-release tag still counts.
    assert.equal((0, npm_name_1.isPrerelease)("1.0.0-rc.1+build-2"), true);
});
(0, node_test_1.test)("a release with hyphenated build metadata stays the headline", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "1.2.3+build-meta": {}, "1.0.0-beta.1": {} }), "1.2.3+build-meta");
});
// A plain string sort puts a beta ahead of every earlier stable release, so the
// page would advertise a score for an artifact npm does not serve.
(0, node_test_1.test)("prefers the newest stable over a higher-sorting pre-release", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "2.1.0": {}, "3.0.0-beta.0": {} }), "2.1.0");
});
// SemVer orders a pre-release below its own release; a string sort does not.
(0, node_test_1.test)("prefers a release over its own release candidate", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "1.0.0": {}, "1.0.0-rc.1": {} }), "1.0.0");
});
(0, node_test_1.test)("takes the newest stable once the pre-release ships", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "2.1.0": {}, "3.0.0-beta.0": {}, "3.0.0": {} }), "3.0.0");
});
// A plugin that has only ever published pre-releases should still appear,
// rather than dropping off the page entirely.
(0, node_test_1.test)("falls back to a pre-release when there is no stable version", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "1.0.0-alpha.1": {}, "1.0.0-beta.2": {} }), "1.0.0-beta.2");
});
// markOutdated eventually flags a pre-release once a nightly runs against the
// real dist-tags.latest, but only then. Between a rescore and that nightly —
// and for the sixteen days signalk-victron-ble-consumer sat this way — nothing
// is flagged, so the picker has to be right on its own.
(0, node_test_1.test)("is correct before markOutdated has flagged anything", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "2.1.0": {}, "3.0.0-beta.0": {} }), "2.1.0");
    assert.equal((0, build_api_1.pickDisplayVersion)({ "0.2.0-beta.1": {}, "0.2.0": {} }), "0.2.0");
});
(0, node_test_1.test)("skips versions marked outdated", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "1.0.0": {}, "2.0.0": { outdated: true } }), "1.0.0");
});
// Numeric collation, not lexicographic: "10.0.0" must beat "9.0.0".
(0, node_test_1.test)("orders versions numerically", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "9.0.0": {}, "10.0.0": {} }), "10.0.0");
});
(0, node_test_1.test)("returns nothing when every version is outdated", () => {
    assert.equal((0, build_api_1.pickDisplayVersion)({ "1.0.0": { outdated: true } }), undefined);
});
