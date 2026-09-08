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
const atom_version_1 = require("./atom-version");
// The real shape of https://github.com/openwatersio/aiscast/releases.atom.
// The tag carries a package-name prefix (`signalk-plugin-v0.1.4`) and the
// title separates name from version with a space — neither of which the
// original fixed-substring matcher recognised, so a repo that publishes
// per-version release notes still lost the changelog point.
const AISCAST_ATOM = `<entry>
  <id>tag:github.com,2008:Repository/1340948238/signalk-plugin-v0.1.4</id>
  <title>signalk-aiscast 0.1.4</title>
</entry>`;
(0, node_test_1.test)("matches a monorepo tag prefixed with the package name", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(AISCAST_ATOM, "0.1.4"), true);
});
(0, node_test_1.test)("matches the other common monorepo tag conventions", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)("<id>x/pkg@1.2.3</id>", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)("<id>x/pkg-v1.2.3</id>", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)("<id>x/pkg/v1.2.3</id>", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)("<title>sk 1.2.3</title>", "1.2.3"), true);
});
// The 565 plugins that tag plainly must keep scoring exactly as before.
(0, node_test_1.test)("still matches the plain tag forms", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(">1.2.3<", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)(">v1.2.3<", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)("/v1.2.3<", "1.2.3"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)(":v1.2.3<", "1.2.3"), true);
});
(0, node_test_1.test)("does not match a longer version that merely starts the same", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(">0.1.40<", "0.1.4"), false);
    assert.equal((0, atom_version_1.atomMentionsVersion)("<id>other-pkg-v0.1.44</id>", "0.1.4"), false);
});
(0, node_test_1.test)("does not match a version embedded in surrounding digits", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(">10.1.4<", "0.1.4"), false);
    assert.equal((0, atom_version_1.atomMentionsVersion)("<id>x/11.2.3</id>", "1.2.3"), false);
});
// A prerelease is a different version: the release check must not accept it.
(0, node_test_1.test)("does not accept a prerelease in place of the release", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(">1.2.3-beta.1<", "1.2.3"), false);
});
// Proves the version is regex-escaped: an unescaped `+`/`.` would misbehave.
(0, node_test_1.test)("matches a prerelease version when that is what was asked for", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(">v1.0.0-rc.1<", "1.0.0-rc.1"), true);
    assert.equal((0, atom_version_1.atomMentionsVersion)(">v1.0.0+build.5<", "1.0.0+build.5"), true);
});
(0, node_test_1.test)("an empty version never matches", () => {
    assert.equal((0, atom_version_1.atomMentionsVersion)(AISCAST_ATOM, ""), false);
    assert.equal((0, atom_version_1.atomMentionsVersion)(AISCAST_ATOM, "   "), false);
});
