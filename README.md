# Signal K Plugin Registry

Automated testing and quality scoring for Signal K server plugins.

**Results:** https://dirkwa.github.io/signalk-plugin-registry/

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

Security scoring breakdown: 20 points for a clean audit, 15 if only moderate vulnerabilities, 10 if high (no critical), 0 if any critical vulnerabilities.

Changelog detection prefers a `CHANGELOG.md` (or `CHANGES.md` / `HISTORY.md`) in the published tarball; if absent, falls back to the repository's public GitHub Releases atom feed (`https://github.com/<owner>/<repo>/releases.atom`, no token needed) and looks for a release whose tag matches the installed version. See [signalk-server PR #2615](https://github.com/SignalK/signalk-server/pull/2615) for the release-notes convention.

Screenshots detection requires at least one string entry under `signalk.screenshots` in `package.json`.

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
| `broken` | Failed to install |

## API

Results are published to GitHub Pages:

- `index.json` — summary of all plugins, sorted by score
- `plugins/<name>.json` — full detail for one plugin

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

## Triggering CI

Go to Actions > "Nightly Plugin Registry Scan" > Run workflow:

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
