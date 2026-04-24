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
