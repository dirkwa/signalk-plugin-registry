import { HeldBackCoreDep } from "./core-deps";
import { LegacyDep } from "./legacy-deps";

export interface TestResults {
  installs: boolean;
  loads: boolean;
  activates: boolean;
  detectedProviders: string[];
  hasSchema: boolean;
  hasOwnTests: boolean;
  ownTestsPass: boolean;
  testsRunnable?: boolean;
  auditCritical: number;
  auditHigh: number;
  auditModerate: number;
  hasInstallScripts: boolean;
  hasChangelog: boolean;
  hasScreenshots: boolean;
  heldBackCoreDeps: HeldBackCoreDep[];
  legacyDeps: LegacyDep[];
}

export type Badge =
  | "compatible"
  | "loads"
  | "activates"
  | "has-providers"
  | "tested"
  | "tests-failing"
  | "npm-audit-ok"
  | "audit-moderate"
  | "audit-high"
  | "audit-critical"
  | "has-changelog"
  | "has-screenshots"
  | "holds-back-core-deps"
  | "legacy-baconjs"
  | "legacy-react"
  | "broken";

export type TestStatus = "passing" | "none" | "not-runnable" | "failing";

export function computeScore(r: TestResults): {
  composite: number;
  badges: Badge[];
  testStatus: TestStatus;
} {
  let testStatus: TestStatus;
  if (!r.hasOwnTests) {
    testStatus = "none";
  } else if (r.testsRunnable === false) {
    testStatus = "not-runnable";
  } else if (r.ownTestsPass) {
    testStatus = "passing";
  } else {
    testStatus = "failing";
  }

  if (!r.installs) return { composite: 0, badges: ["broken"], testStatus };

  let score = 0;
  const badges: Badge[] = [];

  // Install: 20 points
  score += 20;
  badges.push("compatible");

  // Loads (constructor succeeds): 15 points
  if (r.loads) {
    score += 15;
    badges.push("loads");
  }

  // Activates (start() completes without error): 15 points
  if (r.activates) {
    score += 15;
    badges.push("activates");
  }

  // Provider registration: informational badge only, no score impact
  if (r.detectedProviders.length > 0) {
    badges.push("has-providers");
  }

  // Has JSON schema: 5 points
  if (r.hasSchema) {
    score += 5;
  }

  // Own tests: 25 points for passing, -5 penalty for actually failing
  // Tests that exist but can't run (missing devDeps) are neutral
  if (testStatus === "passing") {
    score += 25;
    badges.push("tested");
  } else if (testStatus === "failing") {
    score -= 5;
    badges.push("tests-failing");
  }

  // Security: 20 points
  if (r.auditCritical === 0 && r.auditHigh === 0 && r.auditModerate === 0) {
    score += 20;
    badges.push("npm-audit-ok");
  } else if (r.auditCritical === 0 && r.auditHigh === 0) {
    score += 15;
    badges.push("audit-moderate");
  } else if (r.auditCritical === 0) {
    score += 10;
    badges.push("audit-high");
  } else {
    badges.push("audit-critical");
  }

  // Changelog: -5 penalty if absent, informational badge when present.
  // "Present" means either a CHANGELOG.md-style file in the published tarball
  // or a matching GitHub Release tag (see runner.hasChangelog).
  if (r.hasChangelog) {
    badges.push("has-changelog");
  } else {
    score -= 5;
  }

  // Screenshots: -5 penalty if absent, informational badge when present.
  // "Present" means signalk.screenshots in package.json has at least one entry.
  if (r.hasScreenshots) {
    badges.push("has-screenshots");
  } else {
    score -= 5;
  }

  // Core dep freshness: -80 penalty when any declared dependency/peerDependency
  // range excludes the latest same-major release of a core Signal K package.
  // Deliberately near-fatal: such a pin holds the package back in every user's
  // ~/.signalk install (see runner.checkHeldBackCoreDeps).
  if (r.heldBackCoreDeps.length > 0) {
    score -= 80;
    badges.push("holds-back-core-deps");
  }

  // Legacy runtime deps: -15 per library, for baconjs <3 in dependencies/
  // peerDependencies and for an embedded webapp built against React <19.
  // Both only work today through server compatibility shims that are slated
  // for removal (see legacy-deps.ts).
  for (const pkg of new Set(r.legacyDeps.map((dep) => dep.pkg))) {
    score -= 15;
    badges.push(pkg === "baconjs" ? "legacy-baconjs" : "legacy-react");
  }

  return {
    composite: Math.max(0, Math.min(100, score)),
    badges,
    testStatus,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : "";
  };

  const results: TestResults = {
    installs: get("--installs") === "true",
    loads: get("--loads") === "true",
    activates: get("--activates") === "true",
    detectedProviders: JSON.parse(get("--providers") || "[]"),
    hasSchema: get("--has-schema") === "true",
    hasOwnTests: get("--has-own-tests") === "true",
    ownTestsPass: get("--own-tests-pass") === "true",
    auditCritical: parseInt(get("--audit-critical") || "0", 10),
    auditHigh: parseInt(get("--audit-high") || "0", 10),
    auditModerate: parseInt(get("--audit-moderate") || "0", 10),
    hasInstallScripts: get("--has-install-scripts") === "true",
    hasChangelog: get("--has-changelog") === "true",
    hasScreenshots: get("--has-screenshots") === "true",
    heldBackCoreDeps: JSON.parse(get("--held-back-core-deps") || "[]"),
    legacyDeps: JSON.parse(get("--legacy-deps") || "[]"),
  };

  const { composite, badges } = computeScore(results);
  const output = `json=${JSON.stringify({ composite, badges })}\nbadges=${badges.join(",")}`;

  if (process.env.GITHUB_OUTPUT) {
    const fs = require("fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
  } else {
    console.log(`Score: ${composite}/100`);
    console.log(`Badges: ${badges.join(", ")}`);
  }
}
