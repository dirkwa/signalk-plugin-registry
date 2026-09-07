import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  extractFromComment,
  extractFromIssueBody,
  own,
  splitSpecifier,
} from "../scripts/parse-rescore-request";
import { isExactVersion } from "../scripts/npm-name";
import { versionRejection } from "../scripts/resolve-single-plugin";

// The re-score request parser is the trust boundary for the on-demand path:
// everything it returns came from an issue body or a comment, both of which
// anyone can write. These cover the splitting and extraction; the npm-grammar
// and keyword gates live behind a network call and are exercised in the
// workflow itself.

test("splitSpecifier: a bare name has no specifier", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin"), {
    name: "signalk-my-plugin",
    specifier: "",
  });
});

test("splitSpecifier: a dist-tag is separated from the name", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@beta"), {
    name: "signalk-my-plugin",
    specifier: "beta",
  });
});

test("splitSpecifier: an exact version is separated from the name", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@2.0.0-rc.1"), {
    name: "signalk-my-plugin",
    specifier: "2.0.0-rc.1",
  });
});

// The scope marker is an `@` at position 0, and splitting on it would leave
// the name empty and the specifier holding the whole package name.
test("splitSpecifier: a scoped name without a specifier stays intact", () => {
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin"), {
    name: "@signalk/tracks-plugin",
    specifier: "",
  });
});

test("splitSpecifier: a scoped name splits on the last @", () => {
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin@next"), {
    name: "@signalk/tracks-plugin",
    specifier: "next",
  });
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin@3.0.0-beta.0"), {
    name: "@signalk/tracks-plugin",
    specifier: "3.0.0-beta.0",
  });
});

// A trailing `@` is a typo rather than a request for a tag named "". It falls
// back to latest, which is the same thing a bare name does.
test("splitSpecifier: a trailing @ yields an empty specifier", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@"), {
    name: "signalk-my-plugin",
    specifier: "",
  });
});

test("extractFromComment: reads the name after /rescore", () => {
  assert.equal(extractFromComment("/rescore signalk-my-plugin"), "signalk-my-plugin");
});

test("extractFromComment: keeps a specifier attached to the name", () => {
  assert.equal(
    extractFromComment("/rescore @signalk/tracks-plugin@next"),
    "@signalk/tracks-plugin@next",
  );
});

test("extractFromComment: tolerates backtick fencing", () => {
  assert.equal(extractFromComment("/rescore `signalk-my-plugin@beta`"), "signalk-my-plugin@beta");
});

test("extractFromComment: ignores a comment that is not a command", () => {
  assert.equal(extractFromComment("please rescore signalk-my-plugin"), "");
});

test("extractFromIssueBody: reads the answer under the heading", () => {
  const body = ["### npm package name", "", "signalk-my-plugin", "", "### Confirmation", "- [X] yes"].join(
    "\n",
  );
  assert.equal(extractFromIssueBody(body), "signalk-my-plugin");
});

test("extractFromIssueBody: keeps a specifier the author typed", () => {
  const body = "### npm package name\n\n@signalk/tracks-plugin@beta\n";
  assert.equal(extractFromIssueBody(body), "@signalk/tracks-plugin@beta");
});

// GitHub writes CRLF line endings on some clients; splitting on \n alone would
// leave a trailing \r on the extracted name and fail the npm-grammar gate.
test("extractFromIssueBody: handles CRLF line endings", () => {
  assert.equal(extractFromIssueBody("### npm package name\r\n\r\nsignalk-my-plugin\r\n"), "signalk-my-plugin");
});

test("extractFromIssueBody: returns nothing when the heading is absent", () => {
  assert.equal(extractFromIssueBody("just some prose"), "");
});

// A resolved version is interpolated unescaped into `npm install <name>@<v>`
// in test-harness/runner.ts, the same surface isValidNpmName fences for the
// name. It arrives either from an issue body or from a workflow_dispatch
// input, so both ends validate through here.

test("isExactVersion: accepts the versions npm actually publishes", () => {
  for (const v of ["1.0.0", "3.0.0-beta.0", "2.0.0-rc.1", "1.2.3+build.4", "0.0.1"]) {
    assert.equal(isExactVersion(v), true, v);
  }
});

test("isExactVersion: rejects shell metacharacters", () => {
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
    assert.equal(isExactVersion(v), false, v);
  }
});

// A leading `-` reads as an option flag once the version reaches
// `npm install <name>@<version>`, the same reason isValidNpmName excludes it.
test("isExactVersion: rejects a leading dash and an empty string", () => {
  assert.equal(isExactVersion("--force"), false);
  assert.equal(isExactVersion("-1.0.0"), false);
  assert.equal(isExactVersion(""), false);
});

// npm's packument is parsed from a network response, so a plain `obj[key]`
// lookup reaches Object.prototype: `@constructor` resolved to
// "function Object() { [native code] }" and flowed to the shell.
test("isExactVersion: rejects prototype leakage", () => {
  assert.equal(isExactVersion("function Object() { [native code] }"), false);
  assert.equal(isExactVersion("[object Object]"), false);
});

test("isExactVersion: rejects an over-long version", () => {
  assert.equal(isExactVersion("1" + ".0".repeat(200)), false);
});

// The packument is parsed from a network response, so a plain `obj[key]` read
// reaches Object.prototype. `@constructor` resolved to
// "function Object() { [native code] }" and flowed into a shell command.
// The version grammar does not cover this on its own where a prototype key is
// itself version-shaped, so the own-property read is the control that rejects
// it.
test("own: reads only own properties", () => {
  const versions = JSON.parse('{"1.0.0": {"version": "1.0.0"}}');
  assert.deepEqual(own(versions, "1.0.0"), { version: "1.0.0" });
  for (const key of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
    assert.equal(own(versions, key), undefined, key);
  }
});

test("own: tolerates an absent container", () => {
  assert.equal(own(undefined, "1.0.0"), undefined);
});

// Anything reaching the matrix becomes a results.json key, so it must be an
// exact version. A dist-tag is alphanumeric and would pass a plain
// shell-safety check, but a run keyed on `beta` writes a slot under that name
// beside the real versions, and slots are never deleted.

test("isExactVersion: accepts exact npm versions", () => {
  for (const v of ["1.0.0", "3.0.0-beta.0", "2.0.0-rc.1", "1.2.3+build.4", "0.0.1", "10.20.30"]) {
    assert.equal(isExactVersion(v), true, v);
  }
});

// A dist-tag is alphanumeric, so a plain shell-safety check would pass it —
// but a run keyed on `beta` writes a permanent slot under that name.
test("isExactVersion: rejects dist-tags", () => {
  for (const tag of ["latest", "next", "beta", "alpha", "canary"]) {
    assert.equal(isExactVersion(tag), false, tag);
  }
});

test("isExactVersion: rejects partial and malformed versions", () => {
  for (const v of ["1.0", "1", "v1.0.0", "1.0.0.0", "", "1.0.0 ", "^1.0.0", "~1.0.0"]) {
    assert.equal(isExactVersion(v), false, JSON.stringify(v));
  }
});

test("isExactVersion: rejects shell metacharacters", () => {
  for (const v of ["1.0.0; id", "$(id)", "`id`", "1.0.0 && id"]) {
    assert.equal(isExactVersion(v), false, v);
  }
});

// The version gate in resolve-single-plugin: what may reach the matrix once a
// dispatch names an explicit version.

test("versionRejection: accepts a published exact version", () => {
  const versions = JSON.parse('{"2.1.0": {}, "3.0.0-beta.0": {}}');
  assert.equal(versionRejection("pkg", "2.1.0", versions), undefined);
  assert.equal(versionRejection("pkg", "3.0.0-beta.0", versions), undefined);
});

// Shaped like a version but npm does not have it: the install fails and a
// scored slot is still written under that key, permanently.
test("versionRejection: rejects an unpublished version", () => {
  const versions = JSON.parse('{"2.1.0": {}}');
  assert.match(versionRejection("pkg", "99.99.99", versions) ?? "", /not published/);
});

test("versionRejection: rejects a dist-tag", () => {
  const versions = JSON.parse('{"2.1.0": {}}');
  assert.match(versionRejection("pkg", "beta", versions) ?? "", /Not an exact/);
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
test("versionRejection: rejects prototype keys that look like versions", () => {
  const versions = JSON.parse('{"2.1.0": {}}');
  // Shaped like a version, absent from the map, but present on the prototype
  // chain of any object once someone extends it — which a plain lookup honours.
  Object.defineProperty(Object.prototype, "9.9.9", {
    value: { poisoned: true },
    configurable: true,
    enumerable: false,
  });
  try {
    assert.match(versionRejection("pkg", "9.9.9", versions) ?? "", /not published/);
  } finally {
    delete (Object.prototype as Record<string, unknown>)["9.9.9"];
  }
});

test("versionRejection: rejects prototype method names outright", () => {
  const versions = JSON.parse('{"2.1.0": {}}');
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.notEqual(versionRejection("pkg", key, versions), undefined, key);
  }
});

test("versionRejection: rejects when the packument carries no versions", () => {
  assert.notEqual(versionRejection("pkg", "1.0.0", undefined), undefined);
});
