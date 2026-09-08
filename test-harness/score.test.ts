import { test } from "node:test";
import * as assert from "node:assert/strict";
import { computeScore, TestResults } from "./score";

// A run that earns every point: 20 install + 15 load + 15 activate +
// 5 schema + 25 tests + 20 audit, with no changelog/screenshots penalty.
function fullMarks(): TestResults {
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
    legacyDeps: [],
  };
}

test("no held-back deps leaves score and badges unchanged", () => {
  const { composite, badges } = computeScore(fullMarks());
  assert.equal(composite, 100);
  assert.ok(!badges.includes("holds-back-core-deps"));
});

test("held-back core dep costs 80 and adds the badge", () => {
  const results = fullMarks();
  results.heldBackCoreDeps = [
    { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
  ];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 20);
  assert.ok(badges.includes("holds-back-core-deps"));
});

test("penalty is flat, not per package", () => {
  const results = fullMarks();
  results.heldBackCoreDeps = [
    { pkg: "@signalk/server-api", declared: "~2.9.0", latest: "2.30.0" },
    { pkg: "@canboat/canboatjs", declared: "3.1.0", latest: "3.20.0" },
  ];
  assert.equal(computeScore(results).composite, 20);
});

test("composite clamps at 0 for low-scoring held-back plugins", () => {
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
  assert.equal(computeScore(results).composite, 0);
});

test("no legacy deps leaves score and badges unchanged", () => {
  const { composite, badges } = computeScore(fullMarks());
  assert.equal(composite, 100);
  assert.ok(!badges.includes("legacy-baconjs"));
  assert.ok(!badges.includes("legacy-react"));
});

test("legacy baconjs costs 15 and adds its badge", () => {
  const results = fullMarks();
  results.legacyDeps = [{ pkg: "baconjs", found: "^0.7.88", required: ">=3" }];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 85);
  assert.ok(badges.includes("legacy-baconjs"));
  assert.ok(!badges.includes("legacy-react"));
});

test("legacy React costs 15 and adds its badge", () => {
  const results = fullMarks();
  results.legacyDeps = [{ pkg: "react", found: "16", required: ">=19" }];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 85);
  assert.ok(badges.includes("legacy-react"));
});

test("legacy baconjs and React stack to 30", () => {
  const results = fullMarks();
  results.legacyDeps = [
    { pkg: "baconjs", found: "^0.7.88", required: ">=3" },
    { pkg: "react", found: "16", required: ">=19" },
  ];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 70);
  assert.ok(badges.includes("legacy-baconjs"));
  assert.ok(badges.includes("legacy-react"));
});

test("legacy penalty is per library, not per entry", () => {
  const results = fullMarks();
  results.legacyDeps = [
    { pkg: "baconjs", found: "^0.7.88", required: ">=3" },
    { pkg: "baconjs", found: "^1.0.1", required: ">=3" },
  ];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 85);
  assert.equal(badges.filter((b) => b === "legacy-baconjs").length, 1);
});

test("legacy deps do not apply to a broken install", () => {
  const results = fullMarks();
  results.installs = false;
  results.legacyDeps = [{ pkg: "react", found: "16", required: ">=19" }];
  const { composite, badges } = computeScore(results);
  assert.equal(composite, 0);
  assert.deepEqual(badges, ["broken"]);
});
