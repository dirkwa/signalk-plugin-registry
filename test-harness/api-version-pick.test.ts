import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isPrerelease } from "../scripts/npm-name";
import { pickDisplayVersion } from "../scripts/build-api";

// The real function build-api.ts uses, imported rather than reimplemented — a
// copy here would pass while the page did something else.

test("isPrerelease: identifies pre-release versions", () => {
  for (const v of ["3.0.0-beta.0", "1.0.0-alpha.1", "2.0.0-rc.1", "1.2.3-next.4"]) {
    assert.equal(isPrerelease(v), true, v);
  }
  for (const v of ["1.0.0", "2.1.0", "10.20.30", "1.2.3+build.4"]) {
    assert.equal(isPrerelease(v), false, v);
  }
});

// SemVer puts build metadata after `+` and the pre-release tag before it, so a
// hyphen in the metadata does not make a release a pre-release.
test("isPrerelease: ignores a hyphen inside build metadata", () => {
  assert.equal(isPrerelease("1.2.3+build-meta"), false);
  assert.equal(isPrerelease("1.2.3+sha-abc123"), false);
  // Both parts present: the pre-release tag still counts.
  assert.equal(isPrerelease("1.0.0-rc.1+build-2"), true);
});

test("a release with hyphenated build metadata stays the headline", () => {
  assert.equal(
    pickDisplayVersion({ "1.2.3+build-meta": {}, "1.0.0-beta.1": {} }),
    "1.2.3+build-meta",
  );
});

// A plain string sort puts a beta ahead of every earlier stable release, so the
// page would advertise a score for an artifact npm does not serve.
test("prefers the newest stable over a higher-sorting pre-release", () => {
  assert.equal(pickDisplayVersion({ "2.1.0": {}, "3.0.0-beta.0": {} }), "2.1.0");
});

// SemVer orders a pre-release below its own release; a string sort does not.
test("prefers a release over its own release candidate", () => {
  assert.equal(pickDisplayVersion({ "1.0.0": {}, "1.0.0-rc.1": {} }), "1.0.0");
});

test("takes the newest stable once the pre-release ships", () => {
  assert.equal(
    pickDisplayVersion({ "2.1.0": {}, "3.0.0-beta.0": {}, "3.0.0": {} }),
    "3.0.0",
  );
});

// A plugin that has only ever published pre-releases should still appear,
// rather than dropping off the page entirely.
test("falls back to a pre-release when there is no stable version", () => {
  assert.equal(
    pickDisplayVersion({ "1.0.0-alpha.1": {}, "1.0.0-beta.2": {} }),
    "1.0.0-beta.2",
  );
});

// markOutdated eventually flags a pre-release once a nightly runs against the
// real dist-tags.latest, but only then. Between a rescore and that nightly —
// and for the sixteen days signalk-victron-ble-consumer sat this way — nothing
// is flagged, so the picker has to be right on its own.
test("is correct before markOutdated has flagged anything", () => {
  assert.equal(
    pickDisplayVersion({ "2.1.0": {}, "3.0.0-beta.0": {} }),
    "2.1.0",
  );
  assert.equal(
    pickDisplayVersion({ "0.2.0-beta.1": {}, "0.2.0": {} }),
    "0.2.0",
  );
});

test("skips versions marked outdated", () => {
  assert.equal(pickDisplayVersion({ "1.0.0": {}, "2.0.0": { outdated: true } }), "1.0.0");
});

// Numeric collation, not lexicographic: "10.0.0" must beat "9.0.0".
test("orders versions numerically", () => {
  assert.equal(pickDisplayVersion({ "9.0.0": {}, "10.0.0": {} }), "10.0.0");
});

test("returns nothing when every version is outdated", () => {
  assert.equal(pickDisplayVersion({ "1.0.0": { outdated: true } }), undefined);
});
