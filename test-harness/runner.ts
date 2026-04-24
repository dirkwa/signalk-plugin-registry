import { detectProviders, DetectionResult } from "./detect-providers";
import { computeScore, TestResults } from "./score";
import * as path from "path";
import * as fs from "fs";
import { execSync, execFileSync } from "child_process";
import * as os from "os";

// Prevent unhandled errors from crashing the process — plugins can throw async
process.on("uncaughtException", (err) => {
  console.error(`[runner] Uncaught exception (suppressed): ${err.message}`);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[runner] Unhandled rejection (suppressed): ${reason}`);
});

interface RunResult {
  detection: DetectionResult;
  installs: boolean;
  installError?: string;
  auditCritical: number;
  auditHigh: number;
  auditModerate: number;
  hasOwnTests: boolean;
  ownTestsPass: boolean;
  testsRunnable: boolean;
  hasInstallScripts: boolean;
  hasChangelog: boolean;
  hasScreenshots: boolean;
  composite: number;
  badges: string[];
  testStatus: string;
}

function installPlugin(
  pluginName: string,
  pluginVersion: string,
  workDir: string,
): { success: boolean; error?: string; hasInstallScripts: boolean } {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, "package.json"),
    JSON.stringify({ name: "test-env", private: true }),
  );

  let hasInstallScripts = false;
  try {
    execSync(
      `npm install ${pluginName}@${pluginVersion} @signalk/server-api --ignore-scripts 2>&1`,
      { cwd: workDir, timeout: 120_000, stdio: "pipe" },
    );

    const pkgPath = path.join(
      workDir,
      "node_modules",
      pluginName,
      "package.json",
    );
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts || {};
      hasInstallScripts = !!(
        scripts.preinstall ||
        scripts.postinstall ||
        scripts.prepare
      );
    }

    return { success: true, hasInstallScripts };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg.slice(0, 500), hasInstallScripts };
  }
}

function runAudit(workDir: string): {
  critical: number;
  high: number;
  moderate: number;
} {
  try {
    let output: string;
    try {
      output = execSync("npm audit --json 2>/dev/null", {
        cwd: workDir,
        timeout: 30_000,
        stdio: "pipe",
      }).toString();
    } catch (err: unknown) {
      // npm audit exits non-zero when vulnerabilities are found,
      // but stdout still contains valid JSON
      const e = err as { stdout?: Buffer };
      output = e.stdout?.toString() || "";
    }
    if (!output) return { critical: 0, high: 0, moderate: 0 };
    const data = JSON.parse(output);
    const v = data.metadata?.vulnerabilities || {};
    return {
      critical: v.critical || 0,
      high: v.high || 0,
      moderate: v.moderate || 0,
    };
  } catch {
    return { critical: 0, high: 0, moderate: 0 };
  }
}

function checkOwnTests(pluginDir: string): {
  hasTests: boolean;
  pass: boolean;
  runnable: boolean;
} {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const testScript = pkg.scripts?.test;
    if (
      !testScript ||
      testScript.includes('echo "Error') ||
      testScript === "exit 0" ||
      testScript === "npm run build" ||
      testScript === "npm run build:all" ||
      testScript === "npm run compile" ||
      testScript === "tsc"
    ) {
      return { hasTests: false, pass: false, runnable: false };
    }

    // Tests requiring Docker cannot run in our harness
    if (testScript.includes("docker")) {
      return { hasTests: true, pass: false, runnable: false };
    }

    // Check if the test runner is available as a local dependency.
    // Published packages don't include devDependencies, so jest/mocha/vitest
    // won't be in node_modules/.bin/ of the plugin itself.
    const runner = testScript.split(/\s+/)[0];
    const knownRunners = [
      "jest",
      "mocha",
      "vitest",
      "ava",
      "tap",
      "c8",
      "nyc",
      "tsx",
      "ts-mocha",
    ];
    const needsBinary = knownRunners.some(
      (r) => runner === r || testScript.startsWith(r + " "),
    );
    if (needsBinary) {
      const localBin = path.join(pluginDir, "node_modules", ".bin", runner);
      if (!fs.existsSync(localBin)) {
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    if (!hasTestFiles(pluginDir)) {
      return { hasTests: true, pass: false, runnable: false };
    }

    try {
      execSync(sandboxCmd("timeout --kill-after=10s 60s npm test 2>&1"), {
        cwd: pluginDir,
        timeout: 75_000,
        stdio: "pipe",
        killSignal: "SIGKILL",
      });
      return { hasTests: true, pass: true, runnable: true };
    } catch {
      return { hasTests: true, pass: false, runnable: true };
    }
  } catch {
    return { hasTests: false, pass: false, runnable: false };
  }
}

function getGitHubRepoUrl(pluginDir: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const repo = pkg.repository;
    if (!repo) return null;

    let url: string;
    if (typeof repo === "string") {
      url = repo;
    } else if (repo.url) {
      url = repo.url;
    } else {
      return null;
    }

    // Normalize git+https://, git://, ssh:// and shorthand to https
    url = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@github\.com/, "https://github.com")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "");

    if (!url.includes("github.com")) return null;
    return url;
  } catch {
    return null;
  }
}

function hasFirejail(): boolean {
  try {
    execSync("which firejail", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function sandboxCmd(cmd: string): string {
  if (!hasFirejail()) return cmd;
  return [
    "firejail --quiet --net=none",
    "--read-only=/home",
    "--read-only=/etc",
    "--read-only=/var",
    "--",
    cmd,
  ].join(" ");
}

function detectProviderssandboxed(pluginDir: string): DetectionResult {
  const outputFile = path.join(os.tmpdir(), `sk-detect-${Date.now()}.json`);
  const sandboxedScript = path.join(
    __dirname,
    "detect-sandboxed.js",
  );

  const cmd = sandboxCmd(`node ${sandboxedScript} ${pluginDir} ${outputFile}`);

  if (hasFirejail()) {
    console.error("[runner] Running detection under firejail --net=none");
  } else {
    console.error("[runner] firejail not available, running detection without network isolation");
  }

  try {
    execSync(cmd, { timeout: 30_000, stdio: "pipe" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Sandboxed detection failed: ${msg.slice(0, 200)}`);
  }

  if (fs.existsSync(outputFile)) {
    try {
      const result = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
      fs.unlinkSync(outputFile);
      return result;
    } catch {
      fs.unlinkSync(outputFile);
    }
  }

  return {
    pluginId: path.basename(pluginDir),
    pluginName: path.basename(pluginDir),
    providers: [],
    putHandlers: [],
    httpRoutes: [],
    unstubbedAccesses: [],
    loads: false,
    loadError: "sandboxed detection failed",
    activates: false,
    activatesWithoutConfig: false,
    statusMessages: [],
    errorMessages: [],
    hasSchema: false,
  };
}

// Any of these common changelog filenames at the package root counts.
// Matches the convention from signalk-server PR #2615 — a CHANGELOG.md in
// the tarball is one of the two acceptable sources of per-version notes
// (the other is a GitHub Release for the tag, not checked here because the
// test job runs without a GITHUB_TOKEN; that check is a future enhancement).
const CHANGELOG_FILENAMES = new Set([
  "CHANGELOG.md",
  "CHANGELOG",
  "CHANGELOG.txt",
  "CHANGES.md",
  "CHANGES",
  "HISTORY.md",
  "HISTORY",
]);

function hasChangelogFile(pluginDir: string): boolean {
  try {
    const entries = fs.readdirSync(pluginDir);
    const upper = entries.map((e) => e.toUpperCase());
    for (const candidate of CHANGELOG_FILENAMES) {
      if (upper.includes(candidate.toUpperCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function githubSlugFromPackage(
  pluginDir: string,
): { owner: string; repo: string } | undefined {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const repoField = pkg?.repository;
    const url: string | undefined =
      typeof repoField === "string"
        ? repoField
        : typeof repoField?.url === "string"
          ? repoField.url
          : undefined;
    if (!url) return undefined;
    // Normalise common forms: git+https://github.com/o/r.git, git@github.com:o/r.git, https://github.com/o/r
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.#]+?)(?:\.git)?(?:#.*)?$/i);
    if (!m) return undefined;
    return { owner: m[1], repo: m[2] };
  } catch {
    return undefined;
  }
}

// The GitHub Releases atom feed is public and not rate-limited by the
// /user-level 60/h that api.github.com imposes. Fetching
// https://github.com/<owner>/<repo>/releases.atom from the untrusted test
// job is safe — no token needed — and tells us whether the plugin author
// publishes per-version release notes (the canonical source per PR #2615).
async function hasReleaseForVersion(
  pluginDir: string,
  version: string,
): Promise<boolean> {
  const slug = githubSlugFromPackage(pluginDir);
  if (!slug) return false;
  const url = `https://github.com/${slug.owner}/${slug.repo}/releases.atom`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/atom+xml" },
    });
    if (!res.ok) return false;
    const body = await res.text();
    // Minimal atom parse: each <entry> has an <id> like
    // tag:github.com,2008:Repository/…/<tag>  and a <title>.
    // Accept the version string appearing in any of those.
    const v = version.trim();
    if (!v) return false;
    const patterns = [
      `>${v}<`,
      `>v${v}<`,
      `/${v}<`,
      `/v${v}<`,
      `:${v}<`,
      `:v${v}<`,
    ];
    return patterns.some((p) => body.includes(p));
  } catch {
    return false;
  }
}

async function hasChangelog(
  pluginDir: string,
  version: string,
): Promise<boolean> {
  if (hasChangelogFile(pluginDir)) return true;
  return await hasReleaseForVersion(pluginDir, version);
}

function hasScreenshots(pluginDir: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const shots = pkg?.signalk?.screenshots;
    return (
      Array.isArray(shots) &&
      shots.some((s: unknown) => typeof s === "string" && s.trim().length > 0)
    );
  } catch {
    return false;
  }
}

function hasTestFiles(dir: string): boolean {
  try {
    const output = execSync(
      'find . -not -path "*/node_modules/*" -not -path "*/.git/*" \\( ' +
        '-name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" -o ' +
        '-name "test.js" -o -name "test.ts" -o -path "*/test/*" -o ' +
        '-path "*/tests/*" -o -path "*/__tests__/*" \\) -print -quit',
      { cwd: dir, timeout: 5_000, stdio: "pipe" },
    )
      .toString()
      .trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

function checkSourceTests(pluginDir: string): {
  hasTests: boolean;
  pass: boolean;
  runnable: boolean;
} {
  const repoUrl = getGitHubRepoUrl(pluginDir);
  if (!repoUrl) {
    console.error("[runner] No GitHub repo URL found, tests not runnable");
    return { hasTests: true, pass: false, runnable: false };
  }

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-source-"));
  try {
    console.error(`[runner] Cloning source from ${repoUrl}...`);
    try {
      execSync(`git clone --depth 1 ${repoUrl} ${sourceDir} 2>&1`, {
        timeout: 60_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[runner] Failed to clone repo: ${msg.slice(0, 200)}`);
      return { hasTests: true, pass: false, runnable: false };
    }

    if (!hasTestFiles(sourceDir)) {
      console.error(
        "[runner] No test files found in source repo, treating as no tests",
      );
      return { hasTests: false, pass: false, runnable: false };
    }

    console.error("[runner] Installing devDependencies...");
    try {
      execSync("npm ci --ignore-scripts 2>&1", {
        cwd: sourceDir,
        timeout: 120_000,
        stdio: "pipe",
      });
    } catch {
      console.error("[runner] npm ci failed, trying npm install...");
      try {
        execSync("npm install --ignore-scripts 2>&1", {
          cwd: sourceDir,
          timeout: 120_000,
          stdio: "pipe",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[runner] npm install failed, tests not runnable: ${msg.slice(0, 200)}`,
        );
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    const sourcePkg = JSON.parse(
      fs.readFileSync(path.join(sourceDir, "package.json"), "utf-8"),
    );
    const buildScript = sourcePkg.scripts?.["build:all"]
      ? "build:all"
      : sourcePkg.scripts?.["build"]
        ? "build"
        : sourcePkg.scripts?.["compile"]
          ? "compile"
          : null;
    if (buildScript) {
      console.error(`[runner] Building with npm run ${buildScript}...`);
      try {
        execSync(`npm run ${buildScript} 2>&1`, {
          cwd: sourceDir,
          timeout: 120_000,
          stdio: "pipe",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[runner] Build failed, tests not runnable: ${msg.slice(0, 200)}`,
        );
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    console.error("[runner] Running tests from source...");
    execSync(sandboxCmd("timeout --kill-after=10s 60s npm test 2>&1"), {
      cwd: sourceDir,
      timeout: 75_000,
      stdio: "pipe",
      killSignal: "SIGKILL",
    });
    return { hasTests: true, pass: true, runnable: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Source tests failed: ${msg.slice(0, 200)}`);
    return { hasTests: true, pass: false, runnable: true };
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

export async function runPluginTest(
  pluginName: string,
  pluginVersion: string,
): Promise<RunResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-registry-"));

  console.error(`[runner] Installing ${pluginName}@${pluginVersion}...`);
  const install = installPlugin(pluginName, pluginVersion, workDir);

  if (!install.success) {
    console.error(`[runner] Install failed: ${install.error}`);
    const score = computeScore({
      installs: false,
      loads: false,
      activates: false,
      detectedProviders: [],
      hasSchema: false,
      hasOwnTests: false,
      ownTestsPass: false,
      auditCritical: 0,
      auditHigh: 0,
      auditModerate: 0,
      hasInstallScripts: false,
      hasChangelog: false,
      hasScreenshots: false,
    });

    fs.rmSync(workDir, { recursive: true, force: true });

    return {
      detection: {
        pluginId: pluginName,
        pluginName,
        providers: [],
        putHandlers: [],
        httpRoutes: [],
        unstubbedAccesses: [],
        loads: false,
        loadError: install.error,
        activates: false,
        activatesWithoutConfig: false,
        statusMessages: [],
        errorMessages: [],
        hasSchema: false,
      },
      installs: false,
      installError: install.error,
      auditCritical: 0,
      auditHigh: 0,
      auditModerate: 0,
      hasOwnTests: false,
      ownTestsPass: false,
      testsRunnable: false,
      hasInstallScripts: false,
      hasChangelog: false,
      hasScreenshots: false,
      ...score,
    };
  }

  console.error(`[runner] Running audit...`);
  const audit = runAudit(workDir);

  const pluginDir = path.join(workDir, "node_modules", pluginName);
  console.error(`[runner] Detecting providers...`);
  const detection = detectProviderssandboxed(pluginDir);

  console.error(`[runner] Checking own tests...`);
  let ownTests = checkOwnTests(pluginDir);

  // If tests exist but can't run from the published package (missing devDeps),
  // try cloning the source repo and running tests there
  if (ownTests.hasTests && !ownTests.runnable) {
    console.error(
      "[runner] Tests not runnable from npm package, trying source repo...",
    );
    ownTests = checkSourceTests(pluginDir);
  }

  console.error(`[runner] Checking changelog + screenshots...`);
  const shots = hasScreenshots(pluginDir);
  const changelog = await hasChangelog(pluginDir, pluginVersion);

  const testResults: TestResults = {
    installs: true,
    loads: detection.loads,
    activates: detection.activates,
    detectedProviders: detection.providers,
    hasSchema: detection.hasSchema,
    hasOwnTests: ownTests.hasTests,
    ownTestsPass: ownTests.pass,
    testsRunnable: ownTests.runnable,
    auditCritical: audit.critical,
    auditHigh: audit.high,
    auditModerate: audit.moderate,
    hasInstallScripts: install.hasInstallScripts,
    hasChangelog: changelog,
    hasScreenshots: shots,
  };

  const { composite, badges, testStatus } = computeScore(testResults);

  fs.rmSync(workDir, { recursive: true, force: true });

  return {
    detection,
    installs: true,
    auditCritical: audit.critical,
    auditHigh: audit.high,
    auditModerate: audit.moderate,
    hasOwnTests: ownTests.hasTests,
    ownTestsPass: ownTests.pass,
    testsRunnable: ownTests.runnable,
    hasInstallScripts: install.hasInstallScripts,
    hasChangelog: changelog,
    hasScreenshots: shots,
    composite,
    badges,
    testStatus,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pluginName = args[0];
  const pluginVersion = args[1] || "latest";

  if (!pluginName) {
    console.error("Usage: ts-node runner.ts <plugin-name> [version]");
    process.exit(1);
  }

  runPluginTest(pluginName, pluginVersion)
    .then((result) => {
      console.log("\n=== Results ===");
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
