import { detectProviders, DetectionResult } from "./detect-providers";
import { parseDeclaredCiCommands } from "./plugin-ci-commands";
import { atomMentionsVersion } from "./atom-version";
import {
  sanitizeRepoDirectory,
  resolveWithinClone,
  isWorkspaceLinked,
} from "./repo-directory";
import { computeScore, TestResults } from "./score";
import {
  CORE_PACKAGES,
  HeldBackCoreDep,
  fetchLatestVersions,
  findHeldBackCoreDeps,
} from "./core-deps";
import { LegacyDep, checkLegacyDeps } from "./legacy-deps";
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

// execSync surfaces only "Command failed: ..." in err.message; the actual
// subprocess output is on err.stdout/err.stderr (Buffers, since stdio: "pipe").
// Pull all three together so log lines show what really went wrong.
// The default cap is sized to fit vitest's verbose output for ~3 failures
// (each ~2 KB with stack trace). node:test is terser. Callers that know
// they only want the first line (companion-install failures, etc.) can
// pass a smaller cap.
function formatExecError(err: unknown, maxLen = 16_000): string {
  if (!(err instanceof Error)) return String(err).slice(0, maxLen);
  const e = err as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
  const parts = [e.message];
  const stderr = e.stderr?.toString().trim();
  const stdout = e.stdout?.toString().trim();
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);
  return parts.join(" | ").slice(0, maxLen);
}

// Compact reason for a detection subprocess that left no result file behind.
// In-process crashes write their own crash result (detect-sandboxed.ts), so
// this only has to explain the ways the process can die without one: the
// sandbox-internal `timeout` (124, or 137 once kill-after escalates), the
// runner's own execSync SIGKILL, or firejail/node failing outright — where
// the first error-looking stderr line is the best available evidence.
function summarizeDetectionFailure(err: unknown): string {
  const e = err as Error & {
    status?: number;
    signal?: string;
    stderr?: Buffer | string;
  };
  if (e?.status === 124) return "detection timed out after 30s";
  if (e?.status === 137) return "detection killed (timeout enforcement or OOM)";
  if (e?.signal === "SIGKILL") return "detection killed after 45s (runner timeout)";
  const lines = (e?.stderr?.toString() ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const line = lines.find((l) => /error/i.test(l)) ?? lines[0];
  if (line) return line.slice(0, 300);
  return e instanceof Error ? e.message.slice(0, 300) : String(err).slice(0, 300);
}

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
  heldBackCoreDeps: HeldBackCoreDep[];
  legacyDeps: LegacyDep[];
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

      // Honor `signalk.requires` (mirror of SignalK/signalk-server#2698) so
      // plugins that declare companion deps can be tested under realistic
      // conditions. Failure is logged but non-fatal — the plugin's own
      // load/activate outcome still feeds the score.
      const requires: string[] = Array.isArray(pkg?.signalk?.requires)
        ? pkg.signalk.requires.filter(
            (r: unknown): r is string => typeof r === "string" && r.length > 0,
          )
        : [];

      if (requires.length > 0) {
        console.error(
          `[runner] Installing signalk.requires companions: ${requires.join(", ")}`,
        );
        try {
          // execFileSync (vs execSync + shell interpolation) keeps untrusted
          // package.json content off the shell command line.
          execFileSync(
            "npm",
            ["install", "--ignore-scripts", "--", ...requires],
            { cwd: workDir, timeout: 120_000, stdio: "pipe" },
          );
        } catch (err: unknown) {
          console.error(
            `[runner] Companion install failed (continuing): ${formatExecError(err, 300)}`,
          );
        }
      }
    }

    return { success: true, hasInstallScripts };
  } catch (err: unknown) {
    return { success: false, error: formatExecError(err, 500), hasInstallScripts };
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
        env: { ...process.env, SIGNALK_REGISTRY_TEST: "1" },
      });
      return { hasTests: true, pass: true, runnable: true };
    } catch {
      return { hasTests: true, pass: false, runnable: true };
    }
  } catch {
    return { hasTests: false, pass: false, runnable: false };
  }
}

// The repository a plugin was published from. `directory` is npm's standard
// field for a package that lives in a subdirectory of a monorepo; it is null
// for the ordinary one-package-per-repo case.
interface PluginRepo {
  url: string;
  directory: string | null;
}

function getGitHubRepoUrl(pluginDir: string): PluginRepo | null {
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
    // The shorthand string form carries no subdirectory.
    const directory =
      typeof repo === "string" ? null : sanitizeRepoDirectory(repo.directory);
    return { url, directory };
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
    "firejail --quiet",
    // --noprofile: run with ONLY the explicit flags below, never an
    // auto-selected profile. firejail otherwise picks a profile from the
    // payload's basename, so `node …` loaded the heavy nodejs-common.profile
    // (seccomp, caps-drop-all, private-dev, private-tmp) while `timeout … npm
    // test` loaded default.profile — two different sandboxes for the same
    // threat model, and the profile's private /tmp silently dropped the
    // detection result file once we wrapped detection in `timeout`. Pinning
    // --noprofile makes every plugin-code path identical and matches the
    // documented model in AGENTS.md: the load-bearing isolation is --net=none
    // plus the read-only mounts, NOT firejail's auto seccomp/caps profile. It
    // also drops the default profile's `noexec /tmp`, which previously needed
    // an explicit --ignore so require-time native addons (sharp/libvips,
    // canvas, prebuilt better-sqlite3) could mmap their .node binary.
    "--noprofile",
    "--net=none",
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

  // Under firejail, `timeout` lives *inside* the sandbox wrapper (as in
  // checkOwnTests) so it bounds — and reaps — firejail's whole PID namespace,
  // including any subprocess a plugin's start() spawns.
  // signalk-autopilot-provider-garmin spawns `candump`, which under --net=none
  // can't open its AF_CAN socket; the plugin's stop() then SIGTERMs it, and
  // firejail surfaces that 143 up its process group. On a GitHub-hosted runner
  // that propagating SIGTERM tears down the runner agent itself ("received a
  // shutdown signal", exit 143), failing the entire matrix on this one plugin.
  // Wrapping in `timeout` (combined with sandboxCmd's --noprofile, which keeps
  // the output write on the shared /tmp) contains it: detection exits 0 and
  // still produces its result file. The wrapper is gated on hasFirejail() so the
  // unsandboxed local-dev path keeps its raw `node` probe (no GNU `timeout`
  // dependency, which isn't present by default on e.g. macOS).
  const probe = `node ${sandboxedScript} ${pluginDir} ${outputFile}`;
  const cmd = hasFirejail()
    ? sandboxCmd(`timeout --kill-after=10s 30s ${probe}`)
    : probe;

  if (hasFirejail()) {
    console.error("[runner] Running detection under firejail --net=none");
  } else {
    console.error("[runner] firejail not available, running detection without network isolation");
  }

  let execFailure: string | undefined;
  try {
    execSync(cmd, { timeout: 45_000, stdio: "pipe", killSignal: "SIGKILL" });
  } catch (err: unknown) {
    console.error(`[runner] Sandboxed detection failed: ${formatExecError(err)}`);
    execFailure = summarizeDetectionFailure(err);
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
    loadError: execFailure
      ? `sandboxed detection failed: ${execFailure}`
      : "sandboxed detection failed",
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
//
// Distinguishes a confirmed answer from an indeterminate one so a transient
// blip can't be mistaken for "no changelog". A 200 is authoritative (an empty
// feed genuinely means no release); a 404 means the repo/releases aren't
// reachable, which we also treat as confirmed-absent. Only network errors,
// timeouts, and 5xx/429 are indeterminate — those get retried, and if the feed
// still can't be read we give the benefit of the doubt rather than dock the
// changelog point (mirrors the best-score-wins "don't let a flake downgrade a
// plugin" rule, applied at the source).
async function hasReleaseForVersion(
  pluginDir: string,
  version: string,
): Promise<boolean> {
  const slug = githubSlugFromPackage(pluginDir);
  if (!slug) return false;
  const url = `https://github.com/${slug.owner}/${slug.repo}/releases.atom`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/atom+xml" },
      });
      if (res.ok) return atomMentionsVersion(await res.text(), version);
      if (res.status === 404) return false;
      // Any other status (5xx, 429, 403 abuse-throttling, …) — couldn't read
      // the feed; treat as indeterminate and fall through to retry.
    } catch {
      // network error or timeout — transient; fall through to retry.
    }
  }
  console.error(
    `[runner] releases.atom for ${slug.owner}/${slug.repo} unreachable after retries; not penalizing changelog`,
  );
  return true;
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

// Pure metadata check — reads the installed plugin's declared ranges and asks
// the npm registry for each core package's latest. Runs no plugin code, so no
// sandboxCmd(). A failed lookup or read yields [] (indeterminate, no penalty).
async function checkHeldBackCoreDeps(
  pluginDir: string,
): Promise<HeldBackCoreDep[]> {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const declared: Array<{ pkg: string; range: string }> = [];
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const [name, range] of Object.entries(pkg?.[field] ?? {})) {
        if (CORE_PACKAGES.includes(name) && typeof range === "string") {
          declared.push({ pkg: name, range });
        }
      }
    }
    if (declared.length === 0) return [];
    const latest = await fetchLatestVersions(declared.map((d) => d.pkg));
    return findHeldBackCoreDeps(declared, latest);
  } catch {
    return [];
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

// Run one sandboxed source-repo step (build or test) with an in-sandbox
// `timeout` cap. Returns true on success, false on failure.
//
// Webapp bundlers are the reason a plugin declares its own build/test commands:
// plain `ng build` / `ng test` don't terminate, so the plugin's wrappers detect
// completion and force `process.exit(0)`. But a still-draining esbuild child
// then writes to the closed pipe and the sandboxed process group exits 141
// (128 + SIGPIPE) despite the wrapper's clean exit. That 141 is not a failure:
// vitest/ng exit with an ordinary non-zero code on real build or test failures,
// so only 0 and 141 count as success here.
function runSandboxedStep(
  command: string,
  capSeconds: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): boolean {
  try {
    execSync(
      sandboxCmd(`timeout --kill-after=10s ${capSeconds}s ${command} 2>&1`),
      {
        cwd,
        timeout: (capSeconds + 15) * 1000,
        stdio: "pipe",
        killSignal: "SIGKILL",
        // Webapp bundlers are verbose (Angular prints a per-chunk bundle
        // table); the default 1 MB would make execSync kill a completed build
        // for overflowing the pipe buffer and misreport it as a failure.
        maxBuffer: 10 * 1024 * 1024,
        env,
      },
    );
    return true;
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 141) {
      console.error(
        "[runner] Step exited 141 (SIGPIPE from a force-exiting bundler); treating as success",
      );
      return true;
    }
    console.error(`[runner] Step failed: ${formatExecError(err)}`);
    return false;
  }
}

function checkSourceTests(pluginDir: string): {
  hasTests: boolean;
  pass: boolean;
  runnable: boolean;
} {
  const repo = getGitHubRepoUrl(pluginDir);
  if (!repo) {
    console.error("[runner] No GitHub repo URL found, tests not runnable");
    return { hasTests: true, pass: false, runnable: false };
  }

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-source-"));
  try {
    console.error(`[runner] Cloning source from ${repo.url}...`);
    try {
      execSync(`git clone --depth 1 ${repo.url} ${sourceDir} 2>&1`, {
        timeout: 60_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      console.error(`[runner] Failed to clone repo: ${formatExecError(err)}`);
      return { hasTests: true, pass: false, runnable: false };
    }

    // A monorepo package lives in a subdirectory of its repository. Its tests,
    // scripts and manifest are all down there, so everything except the clone
    // itself, the dependency install and the workflow parse has to be scoped to
    // it — at the root, a sibling package's tests get mistaken for this
    // plugin's. The clone is a boundary: a `directory` that no longer exists
    // (renamed since the version under test was published) falls back to the
    // root, which is exactly the behaviour that predates this field.
    // Resolved so the subdirectory comparison below can't be fooled by a
    // symlinked temp root (/tmp -> /private/tmp on macOS).
    const cloneRoot = fs.realpathSync(sourceDir);
    let packageDir = cloneRoot;
    if (repo.directory) {
      const resolved = resolveWithinClone(cloneRoot, repo.directory);
      if (resolved && fs.existsSync(path.join(resolved, "package.json"))) {
        packageDir = resolved;
        console.error(
          `[runner] Plugin lives in subdirectory ${repo.directory}/`,
        );
      } else {
        console.error(
          `[runner] repository.directory "${repo.directory}" not usable in clone, falling back to repo root`,
        );
      }
    }

    if (!hasTestFiles(packageDir)) {
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
        console.error(
          `[runner] npm install failed, tests not runnable: ${formatExecError(err)}`,
        );
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    // The root install covers the subdirectory only when it is a real npm
    // workspace — then npm hoists the deps to the root and links the package
    // back in at <root>/node_modules/<name>. That symlink is the reliable
    // discriminator: a workspace package has *no* node_modules of its own
    // (deps hoist), so checking for one would wrongly re-install the very case
    // it is meant to skip. Without the link the root install said nothing
    // about this package — it may even have succeeded vacuously, as it does
    // for a repo with no root manifest at all — so install the subdirectory
    // on its own. `install`, not `ci`: a non-workspace subdirectory usually
    // ships no lockfile. The budget is deliberately tighter than the root's:
    // this installs one package's devDependencies, and the whole matrix leg
    // has 10 minutes for everything (see nightly.yml).
    if (packageDir !== cloneRoot && !isWorkspaceLinked(cloneRoot, packageDir)) {
      console.error(
        "[runner] Subdirectory is not an npm workspace, installing it directly...",
      );
      try {
        execSync("npm install --ignore-scripts 2>&1", {
          cwd: packageDir,
          timeout: 90_000,
          stdio: "pipe",
        });
      } catch (err: unknown) {
        console.error(
          `[runner] Subdirectory install failed, tests not runnable: ${formatExecError(err)}`,
        );
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    const sourcePkg = JSON.parse(
      fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"),
    );

    // Honor the build/test commands the plugin declares to the canonical
    // SignalK plugin-ci reusable workflow (issue #48). Webapp-class plugins
    // (Angular/React/Vue) declare terminating wrappers there — e.g. Freeboard-SK
    // uses `npm run build:all` (exits cleanly) and `npm run test:ci` (a
    // terminating `ng test`) — while their plain `build`/`test` scripts are the
    // non-exiting `ng build` and watch-mode `ng test`. Guessing the latter
    // wrongly scores them not-runnable. Reading the declared commands mirrors
    // the CI the registry already tracks for the plugin-ci badge, and needs no
    // GitHub token: the caller workflow file is right here in the clone.
    const declared = parseDeclaredCiCommands(sourceDir);

    // Heuristic build when the plugin declares no build-command: prefer plain
    // `build` over `build:all`. Some plugins (signalk-container) define
    // `build:all` as `build && test`, so running it as the build step would
    // run the suite once here and again in the test step below — redundant, and
    // it wastes the tighter build budget. A plugin's *declared* build-command
    // overrides this: it's what the canonical CI runs, so mirroring it is
    // correct (and it runs sandboxed here, same as the test step).
    const heuristicBuild = sourcePkg.scripts?.["build"]
      ? "npm run build"
      : sourcePkg.scripts?.["build:all"]
        ? "npm run build:all"
        : sourcePkg.scripts?.["compile"]
          ? "npm run compile"
          : null;
    const buildCommand = declared.build ?? heuristicBuild;
    if (buildCommand) {
      // The build runs plugin code, so it goes through the sandbox like the
      // test step below. A real webapp production build is far heavier than a
      // tsc compile — @mxtommy/kip's `ng build --configuration=production`
      // takes ~170s on a fast host, so 180s left no margin for the slower
      // arm/QEMU CI slots. Give a declared build-command a generous budget;
      // the heuristic path (tsc/compile) keeps the tighter one.
      const buildCap = declared.build ? 300 : 120;
      console.error(`[runner] Building with ${buildCommand}...`);
      if (!runSandboxedStep(buildCommand, buildCap, packageDir, process.env)) {
        console.error("[runner] Build failed, tests not runnable");
        return { hasTests: true, pass: false, runnable: false };
      }
    }

    // Log the host-side view of network interfaces so plugin authors
    // reading a "passes locally, fails on CI" report can see what the
    // sandboxed test process will inherit. Under firejail --net=none
    // the sandboxed view collapses to just `lo`; if the host already
    // shows just `lo` then the divergence is somewhere else.
    console.error(
      `[runner] Pre-test host netifs: ${Object.keys(os.networkInterfaces()).join(", ") || "(none)"}`,
    );
    // A declared test-command likewise gets a longer in-sandbox `timeout` — a
    // test-command that has to build a test bundle first won't finish in 60s on
    // a slow slot.
    const testCommand = declared.test ?? "npm test";
    const testCap = declared.test ? 120 : 60;
    console.error(`[runner] Running tests from source with ${testCommand}...`);
    const pass = runSandboxedStep(testCommand, testCap, packageDir, {
      ...process.env,
      SIGNALK_REGISTRY_TEST: "1",
    });
    return { hasTests: true, pass, runnable: true };
  } catch (err: unknown) {
    // Safety net: this function must never crash the runner (see the
    // process-level handlers at the top). The sandboxed steps report failure
    // via runSandboxedStep's boolean; anything that throws here is an
    // unexpected harness-side error (e.g. a malformed source package.json).
    console.error(`[runner] Source-test flow errored: ${formatExecError(err)}`);
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
      heldBackCoreDeps: [],
      legacyDeps: [],
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
      heldBackCoreDeps: [],
      legacyDeps: [],
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

  // Plugins commonly exclude their compiled tests from the npm tarball
  // (e.g. via .npmignore) so the test command in the installed package
  // either can't find them or imports devDependencies that aren't there.
  // In both cases the source repo is the source of truth for "do the
  // tests pass" — fall back to it whenever the tarball run didn't pass,
  // not only when it was unrunnable.
  if (ownTests.hasTests && !ownTests.pass) {
    console.error(
      "[runner] Tests did not pass from npm package, trying source repo...",
    );
    ownTests = checkSourceTests(pluginDir);
  }

  console.error(`[runner] Checking changelog + screenshots...`);
  const shots = hasScreenshots(pluginDir);
  const changelog = await hasChangelog(pluginDir, pluginVersion);

  console.error(`[runner] Checking core dependency ranges...`);
  const heldBack = await checkHeldBackCoreDeps(pluginDir);

  console.error(`[runner] Checking legacy runtime deps (baconjs, React)...`);
  const legacy = checkLegacyDeps(pluginDir);

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
    heldBackCoreDeps: heldBack,
    legacyDeps: legacy,
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
    heldBackCoreDeps: heldBack,
    legacyDeps: legacy,
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
