# Signal K Plugin Registry

Automated testing and quality scoring for Signal K server plugins.

**Results:** https://signalk.org/signalk-plugin-registry/

## What It Does

- Discovers Signal K plugins from npm (keyword: `signalk-node-server-plugin`)
- Tests each plugin against Signal K server: install, load, activate, detect providers, security audit
- Stores results persistently in `results.json` — only retests on version changes
- Publishes a static JSON API via GitHub Pages
- Runs nightly or on manual trigger

## Scoring

Each plugin is scored out of **100 points**:

| Tier | What | Points |
|------|------|--------|
| Install | `npm install --ignore-scripts` succeeds | 20 |
| Load | Constructor returns a valid plugin object | 15 |
| Activate | `start()` completes with schema defaults | 15 |
| Schema | Plugin exposes a JSON configuration schema | 5 |
| Tests | Plugin's own test suite passes | 25 |
| Security | No npm audit vulnerabilities | 20 |
| Changelog | CHANGELOG file or GitHub Release for the version | −5 if missing |
| Screenshots | `signalk.screenshots` array in `package.json` | −5 if missing |
| Core dep freshness | Declared ranges allow the latest same-major release of core Signal K packages | −80 if held back |
| Legacy baconjs | Any `baconjs` range in `dependencies` / `peerDependencies` can resolve to 3.x | −15 if it cannot |
| Legacy React | Embedded webapp bundles register React ≥19 | −15 if <19 |

Security scoring breakdown: 20 points for a clean audit, 15 if only moderate vulnerabilities, 10 if high (no critical), 0 if any critical vulnerabilities.

Changelog detection prefers a `CHANGELOG.md` (or `CHANGES.md` / `HISTORY.md`) in the published tarball; if absent, falls back to the repository's public GitHub Releases atom feed (`https://github.com/<owner>/<repo>/releases.atom`, no token needed) and looks for a release whose tag or entry title carries the installed version. Tags may carry a package-name prefix, so the monorepo conventions (`pkg@1.2.3`, `pkg-v1.2.3`, `pkg/v1.2.3`) are recognised alongside a plain `v1.2.3`. The version must stand on its own, so `1.2.3` never matches a `1.2.30` or `1.2.3-beta.1` release. See [signalk-server PR #2615](https://github.com/SignalK/signalk-server/pull/2615) for the release-notes convention.

Screenshots detection requires at least one string entry under `signalk.screenshots` in `package.json`.

Test scoring runs the plugin's suite from its published tarball, then falls back to a shallow clone of the source repo (devDependencies aren't published, so most suites only run from source). In the source fallback the harness honors the build/test commands a plugin declares to the canonical [`plugin-ci.yml`](https://github.com/SignalK/signalk-server/blob/master/.github/workflows/plugin-ci.yml) reusable workflow, so it mirrors the CI it already tracks for the plugin-ci badge rather than guessing. This is what lets webapp-class plugins (Angular/React/Vue) be scored correctly — their plain build/test scripts are often a non-exiting bundler and a watch-mode runner, which a naive guess would score "not runnable". When a plugin declares no such commands, the harness falls back to its own heuristics.

A plugin published from a subdirectory of its repository is scored there rather than at the repository root, provided it declares npm's standard [`repository.directory`](https://docs.npmjs.com/cli/configuring-npm/package-json#repository) field. Test discovery, the build and the test run all happen in that subdirectory, so a sibling package's tests are never mistaken for the plugin's. Dependencies install at the repository root — which is what npm workspaces expect — and the subdirectory is installed separately when it isn't a workspace. Note that such plugins currently cannot run the reusable `plugin-ci.yml` workflow (it has no working-directory input), so they still take the `no-plugin-ci` penalty; that fix belongs upstream.

Core dep freshness checks the plugin's declared `dependencies` and `peerDependencies` (never `devDependencies` — those don't reach user installs) against the latest npm release of each core Signal K package: `@signalk/server-api`, `@canboat/canboatjs`, `@canboat/ts-pgns`, `@signalk/n2k-signalk`, `@signalk/nmea0183-signalk`, `@signalk/streams`. A range that targets the same major as the latest release but cannot resolve to it (e.g. `~2.9.0` or an exact `2.9.0` when latest is `2.30.0`) holds the package back in every user's `~/.signalk` install and costs −80. Ranges on an older major are not flagged (the plugin may legitimately not support the new major yet), and neither are git/file/URL specs, dist-tags, or invalid ranges. If the npm registry lookup fails, the check is skipped — a registry flake never costs points.

Legacy runtime deps cover two libraries the server provides at a fixed major and only bridges for older plugin builds through temporary compatibility shims. **baconjs**: the server moved to 3.x in 2.24.0 and redirects every `require('baconjs')` to its own copy ([signalk-server#2487](https://github.com/SignalK/signalk-server/pull/2487)); a `dependencies` / `peerDependencies` range that cannot resolve to any 3.x release (e.g. `^0.7.88`, `^1.0.1`) costs −15. **React**: the admin UI is React 19 and renders Module Federation remotes built against React 16 through an isolated bridge ([signalk-server#2451](https://github.com/SignalK/signalk-server/issues/2451)); for plugins with an embedded-webapp keyword (`signalk-embeddable-webapp`, `signalk-plugin-configurator`, `signalk-node-server-addon`) the remote entry the server injects into the admin UI (`public/remoteEntry.js`, or `remoteEntry.js` at the package root without a `public/`) and the chunks reachable from it are scanned for the shared React version they register, and a major below 19 costs −15. Files nothing references — stale builds, unrelated entries — are not consulted, and remotes that consume the host's React without shipping their own are not flagged. Both checks are pure file inspection — no plugin code runs — and an unreadable package or bundle is indeterminate, never a penalty.

Provider detection (resources, weather, history, autopilot, radar) is tracked as an informational badge but does not affect the score — most plugins are not expected to register providers.

## Badges

| Badge | Meaning |
|-------|---------|
| `compatible` | Installs successfully |
| `loads` | Plugin constructor succeeds |
| `activates` | `start()` completes without error (with schema defaults) |
| `has-providers` | Registers at least one provider (informational) |
| `tested` | Plugin has its own test suite and it passes |
| `tests-failing` | Plugin has tests but they fail (-5 penalty) |
| `npm-audit-ok` | No npm audit vulnerabilities (20 pts) |
| `audit-moderate` | Has moderate vulnerabilities (15 pts) |
| `audit-high` | Has high vulnerabilities (10 pts) |
| `audit-critical` | Has critical vulnerabilities (0 pts) |
| `has-changelog` | CHANGELOG file or matching GitHub Release is available |
| `has-screenshots` | Declares at least one `signalk.screenshots` entry |
| `holds-back-core-deps` | A declared range pins a core Signal K package below its latest same-major release (−80 penalty) |
| `legacy-baconjs` | A `dependencies` / `peerDependencies` range for `baconjs` cannot resolve to 3.x (−15 penalty) |
| `legacy-react` | Embedded webapp bundle registers React <19 (−15 penalty) |
| `broken` | Failed to install |

## API

Results are published to GitHub Pages:

- `index.json` — summary of all plugins, sorted by score
- `plugins/<name>.json` — full detail for one plugin

Per-plugin records include upstream informational metrics fetched once per
nightly run so signalk-server installs can display them without each boat
hitting `api.github.com` (60/hr unauthenticated limit). Fields:

- `stars` — GitHub repository stargazer count
- `open_issues` — open issue count (includes PRs)
- `contributors` — contributor count
- `downloads_per_week` — npm weekly downloads
- `github_url` — normalised `https://github.com/<owner>/<repo>` URL

All fields are optional — any combination of GitHub API limits, missing
repositories, or npm throttling can leave them absent. Consumers should
render `—` or a similar empty-state when a field is not present.

## Manual Testing

Test a single plugin locally:

```bash
npm ci
npx ts-node test-harness/runner.ts <plugin-name> [version]
```

Test against a local plugin source:

```bash
npx ts-node test-harness/detect-providers.ts /path/to/plugin
```

## Requesting a Re-Score

If you maintain a plugin and want a fresh score without waiting for the nightly
run — for example right after publishing a fix — open a re-score request:

1. Go to [**New issue**](https://github.com/SignalK/signalk-plugin-registry/issues/new/choose)
   and choose **Request a plugin re-score**.
2. Enter your npm package name (e.g. `signalk-my-plugin` or
   `@scope/signalk-my-plugin`) and submit.

A bot validates the request, runs a single-plugin scan, comments the new score
and badges on the issue, then closes it. This usually takes a few minutes.

Your plugin must be published to npm and carry the `signalk-node-server-plugin`
keyword (the same keyword the Signal K app store uses to discover plugins). If
it isn't a recognised plugin, the bot replies explaining why and closes the
issue without running a scan.

To re-run later on the same issue — after shipping another change — comment
`/rescore <npm-name>`.

You don't need write access to this repository; anyone can open the request.

## Triggering CI

Maintainers can also trigger a scan directly. Go to Actions > "Nightly Plugin
Registry Scan" > Run workflow:

- **changed_only** — only test plugins with new versions since last run
- **all_plugins** — retest everything
- **single_plugin** — test one specific plugin by npm name

## CI Security Model

Plugins are untrusted code. The CI pipeline is designed so that even a deliberately malicious plugin cannot steal secrets, exfiltrate data, tamper with results, or attack third parties.

### Job isolation

The workflow has four jobs. Only the last two have any permissions:

| Job | Permissions | Runs plugin code? |
|-----|------------|-------------------|
| plan | `{}` (none) | No |
| test | `{}` (none) | Yes |
| merge-results | `contents: write` | No |
| publish | `contents: write` | No |

The test job uses `persist-credentials: false` so no token exists in git config either.

### Network isolation (firejail)

All plugin code execution is wrapped in `firejail --net=none`:

- `require()` + `start()` (provider detection) — runs as a sandboxed subprocess
- `npm test` from published packages and from cloned source repos

This prevents plugin code from making any outbound network requests — no data exfiltration, no phoning home for second-stage payloads, no participation in attacks on third parties.

### Filesystem isolation

Firejail runs with `--read-only=/home --read-only=/etc --read-only=/var`. Plugin code cannot modify the workspace, git history, results.json, or npm cache. Only `/tmp` (where plugin workdirs live) is writable.

The sandbox also runs with `--ignore="noexec /tmp"`, which lifts the `noexec /tmp` that firejail's default profile would otherwise apply. Without it, plugins that load a native addon at require-time (`sharp`/libvips, `canvas`, prebuilt `better-sqlite3`, …) fail `dlopen` with `failed to map segment from shared object` and flatline at ~30 for an environment-only reason. This is a deliberate, scoped relaxation: the sandbox's whole job is to execute the plugin's own untrusted JavaScript, so the attacker already has arbitrary code execution before `/tmp` is touched — `noexec /tmp` only blocks the binary-mmap path while leaving the JS path open, so it adds no real boundary here. The load-bearing containment — `--net=none` and the read-only mounts — is unchanged.

### `SIGNALK_REGISTRY_TEST` env var (for plugin authors)

The harness sets `SIGNALK_REGISTRY_TEST=1` in the environment of every `npm test` invocation (both the tarball pass and the source-fallback pass). Plugin authors whose tests need network or a working container daemon can detect the harness and self-skip those tests:

```js
// node:test example
import { describe, it } from "node:test";
describe("my integration test", () => {
  it("pulls an image", { skip: !!process.env.SIGNALK_REGISTRY_TEST }, async () => {
    // …
  });
});
```

`vitest` and `mocha` have equivalent skip mechanisms (`describe.skip(condition)`, `if (cond) this.skip()`). Tests that don't honor the env var still run and are subject to `--net=none`; they typically fail and cost the plugin 30 score points (no `+25` "tested" badge AND a `−5` "tests-failing" penalty). The clean alternative is to split unit and integration tests into separate scripts (e.g. `npm test` for unit, `npm run test:integration` for the rest) so `npm test` is safe to run in any sandbox — that's what `signalk-container` does since 1.10.1.

### Supply chain protection

All plugin dependency installs use `--ignore-scripts` to block `postinstall`/`preinstall` lifecycle scripts from transitive dependencies. The Signal K server itself is installed normally since it is trusted first-party code.

### Artifact validation

The merge job validates every result entry before committing. Each slot must have a valid composite score (0-100), known badge names, ISO timestamp, and boolean installs field. Malformed entries are rejected.

### Best-score-wins

When a plugin is retested, the new result only replaces the old one if its score is equal or higher. A transient CI failure (GitHub 500, npm registry blip) cannot downgrade a plugin that was previously passing.

### Stale result retest

Plugins whose results are older than 7 days are automatically retested on the nightly run. This recovers from transient failures and catches new npm audit vulnerabilities.

## Known Limitations

- Plugins that need real hardware (CAN bus, serial ports) will not activate
- Plugins that require credentials or external services in config will not activate
- `start()` is tested with schema defaults extracted from the plugin's `schema` property — this matches what the admin UI sends. Plugins that need external services (databases, credentials) will still fail activation.
- `activates_without_config` is tracked as an informational field (not scored) showing whether `start({})` with empty config succeeds
- The app shim logs unstubbed method accesses — check `unstubbed_accesses` in results to identify shim gaps
- Plugins that load a native addon at require-time (`sharp`/libvips, `canvas`, prebuilt `better-sqlite3`, …) are supported — the sandbox lifts `noexec /tmp` so the addon binary can map (see Filesystem isolation above). They still need a prebuilt binary for `linux-x64`/Node 24; addons that compile from source at install time fail because installs run with `--ignore-scripts`.

## Contributing

See [AGENTS.md](AGENTS.md) for the contributor / AI agent guide: layout, the security invariants the workflow enforces, slot-key + score-shape rules, and how to reproduce CI failures locally (the firejail-vs-host gotcha is the most common surprise).
