# signalk-plugin-registry

Automated test harness and quality scorer for the Signal K plugin ecosystem. Runs nightly on GitHub Actions and on manual `workflow_dispatch`, publishes results to GitHub Pages at https://signalk.org/signalk-plugin-registry/.

The README covers _what_ this is and how the scoring works. This file is for contributors and AI agents and covers _how it fits together_ and the invariants you can't infer from reading any single file.

## Layout

- **`scripts/discover-plugins.ts`** — npm registry sweep. Returns the union of `keywords: signalk-node-server-plugin` + the curated additions in `registry.json` (plugins that don't carry the keyword but should still be tested).
- **`scripts/resolve-server.ts`** — resolves the current `npm view signalk-server@latest` version and the current `SignalK/signalk-server` `master` SHA. Both become `$GITHUB_OUTPUT` values for `plan-runs.ts`.
- **`scripts/plan-runs.ts`** — emits the GitHub Actions matrix. The `shouldTest` function is the only place that decides whether a `(plugin, version, server-slot)` triple needs a fresh probe. Re-test reasons: `plugin_version_change`, `server_version_change`, `schema_change` (new scoring fields were added), `stale` (>7d), `manual` (`workflow_dispatch` with `mode=single_plugin`/`all_plugins`).
- **`scripts/update-results.ts`** — runs in the test job; takes the runner's JSON output, scores it, and emits the **envelope** (`{ plugin, pluginVersion, slotKey, slotResult }`) that the merge job consumes.
- **`scripts/build-api.ts`** — the GitHub Pages publisher. Reads `results.json`, fetches upstream informational metrics (stars / open issues / contributors / npm weekly downloads / plugin-CI status), writes `dist/api/{index,plugins/<name>}.json`, and generates the human-facing HTML.
- **`test-harness/runner.ts`** — the workhorse. Single export `runPluginTest(name, version)` that installs, loads, activates, scores, and packs the slot envelope. Every plugin-code-touching step is wrapped in `sandboxCmd(...)` (firejail) — see the security section below.
- **`test-harness/score.ts`** — `computeScore(results) → { composite, badges, testStatus }`. The single source of truth for the 0–100 score, the badge set, and the test-status enum.
- **`test-harness/repo-directory.ts`** — validates npm's `repository.directory` (the monorepo subdirectory field) and answers whether the root install already covered that subdirectory. Pure; runs no plugin code.
- **`test-harness/atom-version.ts`** — `atomMentionsVersion(body, version)`, the boundary-aware match against a GitHub Releases atom feed used by the changelog fallback. Pure.
- **`test-harness/core-deps.ts`** — the core-dependency freshness check: `CORE_PACKAGES`, the pure `findHeldBackCoreDeps(declared, latestVersions)` evaluator, and the npm `dist-tags.latest` fetcher. Pure metadata — runs no plugin code, so no `sandboxCmd()`. A failed registry lookup means "indeterminate", never a penalty.
- **`test-harness/legacy-deps.ts`** — the legacy runtime-dep check: `findLegacyBaconjs` (declared `baconjs` range that cannot resolve to 3.x) and `findLegacyReact` (shared React major registered by an embedded webapp's `remoteEntry.js` or the chunks reachable from it — webpack registers in the entry, vite MF in an imported chunk). Mirrors the admin UI's own `containerUsesLegacyReact()` heuristic and plugin-ci's baconjs warning so the three agree. Pure file inspection — runs no plugin code, so no `sandboxCmd()`; an unreadable file is indeterminate, never a penalty.
- **`test-harness/detect-providers.ts`** + **`test-harness/detect-sandboxed.ts`** — `require()` the plugin and call `start()` with `schema-defaults`-extracted config, inside a separate firejail subprocess so a `start()`-time crash doesn't take the harness down.
- **`test-harness/app-shim.ts`** — the fake `app` object Signal K plugins are constructed with. Captures registrations (resource providers, weather, autopilot, history, radar) for the `has-providers` badge. **Unstubbed accesses log to `unstubbedAccesses` rather than throw** — that's how we discover new app-API surface plugins are using.
- **`test-harness/schema-defaults.ts`** — extracts a default config from a plugin's JSON schema. Matches what the Signal K admin UI generates when you click "Submit" without typing anything. Plugins that need real credentials still fail at `start()` but the failure is on the plugin's terms, not because we passed garbage config.
- **`results.json`** — the persistent store. Schema: `{ [pluginName]: { [pluginVersion]: { "server@stable": SlotResult, "server@master"?: SlotResult, outdated?: boolean, superseded_by?: string } } }`. Committed by the `merge-results` job. Each `SlotResult` is validated against the merge-job's `validSlot` predicate before commit (see "Artifact validation" in the README).
- **`registry.json`** — curated list of plugins to test that don't carry the `signalk-node-server-plugin` keyword (e.g. `@signalk/tracks-plugin`). Edit this to add a plugin discovery missed.
- **`.github/workflows/nightly.yml`** — the scan itself. Four jobs: `plan` → `test` (matrix, no secrets) → `merge-results` (commits `results.json`) → `publish` (deploys to `gh-pages`).
- **`.github/workflows/ci.yml`** — the PR gate. Runs `npm test` (which builds with `tsc` first, so it catches build breakage as well as test failures) on every pull request. Two things here are deliberate rather than incidental: it holds `permissions: {}` because it runs no plugin code and writes nothing back, and its push trigger ignores `results.json` — the merge job commits that after every scan, and no test reads it, so gating those pushes would only re-prove an unchanged tree.
- **`.github/actions/setup-server/`** + **`.github/actions/run-plugin-tests/`** — composite actions used inside the matrix. Pulled out so the test job's steps stay readable.

## Code Quality Principles

### Scope and Complexity

YAGNI, SOLID, DRY, KISS. Only make changes that are directly requested or clearly necessary. A bug fix does not need surrounding cleanup; a simple feature does not need extra configurability.

Do not add error handling, fallbacks, or validation for scenarios that cannot happen. Trust internal code and framework guarantees. Only validate at system boundaries: plugin output (which is untrusted), the npm registry, the GitHub API.

### Type Safety

- All new code in TypeScript. No new `.js` source files.
- `tsconfig` is `strict`. Avoid `any`.
- The test harness's `app-shim.ts` is the one place where typed Signal K interfaces meet untyped plugin code — `unknown` and narrow.

### Tests

Unit tests use `node:test` against the compiled output: `npm test` runs `tsc` then `node --test "dist/test-harness/*.test.js"`. Keep new tests pure (no network, no plugin installs) — fixture inputs, deterministic assertions. The integration story is "trigger the workflow against a single plugin" — see "Manual testing" below.

## Security Invariants

These are the rules the harness exists to enforce. **They are load-bearing — the workflow's untrusted-code threat model depends on them.** Do not weaken any of them without explicitly calling it out in the PR description.

### Job permissions

The README has the table. The invariant: **the `test` job runs with `permissions: {}` and `persist-credentials: false`.** A plugin can do whatever it wants inside its sandbox; it can't touch the repo, the `GITHUB_TOKEN`, or any secret. If you find yourself wanting to give the test job any permission to "simplify something", stop. The simplification belongs in the merge or publish job, which never run plugin code.

### Firejail wrapping

Every place that executes plugin code goes through `sandboxCmd()` in `test-harness/runner.ts`. As of writing the sandbox is:

```bash
firejail --quiet --noprofile --net=none --read-only=/home --read-only=/etc --read-only=/var
```

- `--noprofile` — run with **only** the explicit flags above, never a firejail-selected profile. Without it, firejail picks a profile from the payload's basename: `node …` pulled in the heavy `nodejs-common.profile` (seccomp, `caps.drop all`, `private-dev`, `private-tmp`) while `timeout … npm test` pulled in `default.profile`. That divergence was load-bearing-by-accident and actively harmful — the profile's private `/tmp` silently swallowed the detection result file (the symptom that surfaced once the detection probe was wrapped in `timeout`; see below). Pinning `--noprofile` makes every plugin-code path identical and matches the threat model documented here: the isolation is `--net=none` + the read-only mounts, **not** firejail's auto seccomp/caps profile. This is a deliberate weakening of the *incidental* extra hardening (seccomp/caps that we never asked for and that broke on benign plugins) in exchange for a sandbox that is consistent and predictable. If you ever want that hardening back, add the specific directives explicitly (e.g. `--seccomp`, `--caps.drop=all`) rather than letting an auto-profile decide — and re-verify native addons and the `/tmp` result-file write still work.
- `--net=none` — no outbound network. Prevents exfiltration, second-stage download, and SSRF / participation in third-party attacks.
- `--read-only=/home --read-only=/etc --read-only=/var` — plugin code can't tamper with the workspace, git history, or `results.json`. `/tmp` (where plugin workdirs live) is writable.
- **No `noexec /tmp`** — under `--noprofile` firejail loads no profile, so `disable-exec.inc`'s `noexec /tmp` never applies and `/tmp` is exec-able by default. This is what previously required an explicit `--ignore="noexec /tmp"`: require-time native addons (`sharp`/libvips, `canvas`, prebuilt `better-sqlite3`) `mmap` their `.node` binary out of the plugin workdir and otherwise fail `dlopen`, flatlining at ~30 (issue #19). **Do not** re-introduce an auto-profile (or otherwise re-apply `noexec /tmp`) without re-checking that native addons still load.

The detection probe (`detectProviderssandboxed`) additionally wraps its payload in `timeout --kill-after=10s 30s …` *inside* the sandbox, mirroring `checkOwnTests`. This bounds and reaps firejail's whole PID namespace: a plugin's `start()` may spawn a long-lived child (e.g. `signalk-autopilot-provider-garmin` spawns `candump`, which its `stop()` then SIGTERMs), and firejail surfaces that child's 143 up its process group. On a GitHub-hosted runner the propagating SIGTERM tore down the runner agent itself ("received a shutdown signal", exit 143), failing the whole matrix on one plugin. `timeout` keeps detection self-contained: it exits 0 and still writes its result file.

If you add a new code path that executes plugin code (e.g. a new detection probe), it **must** go through `sandboxCmd()`. The harness can detect firejail's absence (`hasFirejail()`) and degrades gracefully on a dev box without it — that's how local testing works — but in CI firejail is always installed.

### `SIGNALK_REGISTRY_TEST` env var

Set to `"1"` in every `npm test` invocation (both the tarball pass in `checkOwnTests` and the source-fallback in `checkSourceTests`). Plugin authors who need to self-skip a test that can't survive `--net=none` use this. See the README for the published contract. **Do not rename or remove this variable** — it's a public interface that plugin authors rely on.

### Supply chain protection

All plugin dependency installs use `--ignore-scripts` to block `postinstall` / `preinstall` lifecycle scripts. Signal K server itself is installed normally because it's trusted first-party code.

### Action pinning (deliberately by tag, not SHA)

Workflow `uses:` references are pinned to major-version tags (`actions/checkout@v7`), **not** commit SHAs. This is a conscious decision, not an oversight — `zizmor`'s `unpinned-uses` rule and reviewers will flag it, and the answer is recorded here and in `.github/zizmor.yml`.

Every action this repo uses is **first-party GitHub** (`actions/checkout`, `actions/setup-node`, `actions/github-script`, `actions/upload-artifact`, `actions/download-artifact`). There are **no third-party actions** — the supply-chain-attack class SHA-pinning defends against (a compromised third-party action retagging to malicious code, e.g. the `tj-actions/changed-files` incident) does not apply. Meanwhile the one job that runs untrusted plugin code already holds `permissions: {}` + `persist-credentials: false`, so even a hypothetically-compromised action there has no token to steal. The token-bearing jobs (`merge-results`, `publish`, `report-rescore`, the `rescore.yml` front door) run no plugin code and use only these first-party actions.

Given that, full-SHA pinning buys a marginal reduction in trust-in-GitHub-itself at the cost of ~10 opaque hashes to keep current. If a third-party action is ever introduced, pin **that** action to a SHA and revisit this stance.

### `npm.requires` companion installs

`runner.ts` reads `signalk.requires` from a plugin's `package.json` (search for the `signalk.requires` block in `runner.ts`) and `npm install`s each companion **before** the plugin's own tests run. This mirrors the behaviour upstream signalk-server adopted in [SignalK/signalk-server#2698](https://github.com/SignalK/signalk-server/pull/2698). When you change this code path, keep it aligned with what upstream does — a divergence makes the registry score either harsher or more lenient than the canonical CI.

### Declared plugin-ci commands in the source fallback

`checkSourceTests` scopes itself to a monorepo subdirectory when the published package declares `repository.directory`. Which steps move is load-bearing: **test discovery, the `package.json` read, the build and the test run use the subdirectory; the clone, the dependency install and `parseDeclaredCiCommands` stay at the repository root** (workflows only ever live at the root). The subdirectory value is npm metadata, i.e. attacker-controlled — it is validated by `sanitizeRepoDirectory` and re-checked for containment against the clone before use, and it must never be interpolated into a shell string; it is only ever an `execSync`/`runSandboxedStep` `cwd`. The extra install for a non-workspace subdirectory keys on the `<root>/node_modules/<name>` symlink npm creates for a workspace, **not** on whether `<subdir>/node_modules` exists — a workspace package's deps hoist to the root, so it normally has none, and that check would re-install exactly the case it means to skip.

`checkSourceTests` honors the `build-command` / `test-command` a plugin declares to the canonical `SignalK/signalk-server/.github/workflows/plugin-ci.yml` reusable workflow, via `parseDeclaredCiCommands` (`test-harness/plugin-ci-commands.ts`). The point (issue #48) is that the registry stops guessing build/test commands that diverge from the CI it already tracks for the plugin-ci badge — the same alignment rule as the `signalk.requires` note above.

Two invariants constrain how it's read and run:

- **Read from the clone, never the GitHub API.** `checkSourceTests` already has the repo on disk, and the test job holds `permissions: {}` + no token — reaching for the API here would break the job-permissions invariant. The parser is a small structural scanner, deliberately **not** a YAML library: no runtime dep is added to the untrusted test job. Keep it that way.
- **Declared commands run plugin code, so they go through `sandboxCmd()`** like every other plugin-code path (build included, via `runSandboxedStep`). They're validated at the boundary — a value that isn't a plain npm-script invocation is rejected and the heuristic is used instead — but the sandbox, not the validation, is the load-bearing containment.

`runSandboxedStep` treats exit **141** (128 + SIGPIPE) as success. Webapp bundlers don't self-terminate, so a plugin's build/test wrapper detects completion and force-`exit(0)`s; a still-draining esbuild child then writes to the closed pipe and the sandboxed group exits 141 despite the clean wrapper exit. A genuinely broken build/test exits with an ordinary code (vitest/ng exit 1), so 141 is unambiguous — **do not "fix" it back to a strict `=== 0` check**, that's the whole reason webapp-class plugins were scored not-runnable (issue #48). The test step is the real gate regardless: a build that only half-completed fails the tests.

### Artifact validation in the merge job

The `validSlot` predicate in `.github/workflows/nightly.yml`'s merge step is the last line of defence. If a compromised test job somehow produced a malformed envelope, `validSlot` rejects it before commit. **Do not relax `validSlot` to make a failing test "easier to handle"** — add a new badge to `VALID_BADGES`, add a new boolean field to the validator, but don't drop checks.

### Retests always overwrite

When a slot is retested, the new result **unconditionally replaces** the old one (`scripts/update-results.ts` — the old composite is only used for the `(was N)` log line). This must stay unconditional: penalties like `holds-back-core-deps` (−80) have to be able to lower a previously good score, and the flake-protection lives elsewhere — checks that depend on external services (releases.atom, npm registry lookups) treat lookup failure as "indeterminate, no penalty" rather than failing the plugin. An earlier revision of this file described a best-score-wins asymmetry; that is not how the code behaves and would be incompatible with penalty rollouts.

## Runtime Invariants

### Slot keys are `server@<slot>`

`server@stable` and `server@master` are the only two recognised slot keys (currently). The merge job rejects anything else with `Skipped non-server slot ...`. If you add a new server slot (e.g. `server@beta`), update both `validSlot`'s allow-list-by-prefix and `build-api.ts`'s composite picker.

### `actions/download-artifact@v8` has two tree shapes

When the merge step matches **multiple** artifacts via `pattern: result-*`, each lands in `<path>/<artifact-name>/`. When it matches **only one**, the artifact extracts directly into `<path>` — no subdirectory. The merge script must walk both shapes; do not assume a single fixed depth. See `.github/workflows/nightly.yml`'s merge step for the walker.

### Plugins discovered today, scored tonight

`discover-plugins.ts` always queries the live npm registry. `plan-runs.ts` reads `results.json` from the *checked-out* repo. There is no caching layer in between. That means: a plugin that publishes a new version at 02:00 UTC will be picked up by that very nightly run. Conversely: if you locally edit `results.json` to delete a slot, the next nightly will re-probe it — that's the intended way to force a re-score.

### `outdated` and `superseded_by` are advisory

`markOutdated` in `plan-runs.ts` walks every version of a plugin and stamps `outdated: true` on every entry that isn't the latest. The API in `build-api.ts` uses this to render the "latest" badge on the published page. It does **not** delete old slots — historical data is retained so the page can show a per-version history. If a plugin author publishes a broken version then unpublishes it, the slot stays around forever with `outdated: true` — that's intentional.

### The `tested` ISO timestamp is the cache key

`shouldTest` uses `Date.now() - new Date(slot.tested).getTime() > 7d` to decide if a slot is stale. If you ever need to rewrite a slot's content out-of-band (data migration), preserve the original `tested` value unless the data really did come from a fresh probe — otherwise you'll prevent legitimate retests.

## Workflow Conventions

This repo is maintained by Dirk Wahrheit. Workflow is deliberate.

### Branch and commit rules

- Branch names use **hyphens**, not slashes (`fix-something`, not `fix/something`).
- Angular conventional commits: `<type>(<scope>): <subject>`. Types: `feat | fix | docs | style | refactor | test | chore | perf`. Subject ≤ 50 chars, imperative mood, no period.
- One logical change per commit, one logical change per PR.
- No `Co-Authored-By` lines. No "Generated with Claude Code" attribution.

### PR rules

- Never commit directly to `master`. Every change goes through a PR.
- PR titles describe **what** changes; PR bodies explain **why** and summarise the approach.
- No checkboxes in PR descriptions.
- PR descriptions must reflect reality — only list what was actually verified, not speculative tests.

### Pre-PR checklist

`ci.yml` runs `npm test` on every pull request, so build breakage and test failures are caught there. There is still no `npm run format` / `npm run ci-lint` — prettier and eslint have no config in this repo, so formatting is not enforced. Run the checks locally anyway; a red PR wastes a round trip:

1. `npm test` — builds with `tsc` and runs the `node:test` unit tests; both must pass. This is what CI runs.
2. If you touched the workflow, dry-run the relevant `node -e` snippet locally against representative fixtures (see "Reproducing failures locally" below). YAML changes that only break at runtime are the most common breakage class in this repo, and `ci.yml` does not exercise `nightly.yml`.
3. `cr review` for non-trivial PRs; skip for `chore(release):` and `chore(deps):` PRs. Pass an explicit base (`--base upstream/master`) — without one it diffs against the local `master`, which silently produces a misleading review when that ref is stale. Check `cr review --help` for current flags rather than trusting a command copied from here; they have changed before.

Only push after the above pass. Never push without explicit approval.

## Reproducing Failures Locally

Three flows worth knowing about — consult `package.json`'s `scripts` block and `.github/workflows/nightly.yml` for the exact invocations:

- **Single-plugin probe** (`test-harness/runner.ts`) — install / load / activate / score one plugin end-to-end. Use this when reproducing a registry score locally.
- **Provider detection only** (`test-harness/detect-providers.ts`) — bypasses the install/score flow and just exercises the `require()` + `start()` path with the schema-defaults config. Use this when iterating on the `app-shim.ts` stub surface.
- **Triggering a CI probe by hand** — the `Nightly Plugin Registry Scan` workflow accepts `mode` (`changed_only` / `all_plugins` / `single_plugin`) and an optional `include_master`. The single-plugin dispatch is the fastest way to validate a fresh publish.

### The firejail-vs-host gotcha

The most common "passes locally, fails on CI" report comes from one source: `hasFirejail()` returns false on dev boxes without firejail installed, so `sandboxCmd()` returns the raw command unwrapped. Plugins that fail under `firejail --net=none` will pass locally on every machine that doesn't have it. Install firejail and re-clone into `/tmp` before concluding a CI failure is a CI bug.

The canonical worked example is the [signalk-container 1.12.1 investigation](https://github.com/dirkwa/signalk-container/pull/126): the env var `container=firejail` flipped the plugin's `isContainerized()` probe and tripped four scripted-exec tests whose stubs assumed a non-containerized host. The SignalK plugin registry CI surfaces this kind of divergence; nothing else in the ecosystem does.

## Common Pitfalls

- **`results.json` is large.** It's 25k+ lines. Don't `cat` it; use `python3 -c "import json; d = json.load(open('results.json')); ..."` or `jq` to slice.
- **The merge job is the silent failure path.** When a `single_plugin` dispatch run shows green jobs but `results.json` is unchanged, look at the `merge-results` job's "Updated N plugin slots" line. If `N=0`, the envelope walker didn't find the file — see the "two tree shapes" invariant above.
- **`hasFirejail()` returns false silently.** On dev boxes without firejail, `sandboxCmd()` returns the raw command unwrapped. Reproductions of "passes locally but fails on CI" depend on having firejail installed locally.
- **Plugin-CI cache.** `build-api.ts` keeps a small on-disk cache (`data/plugin-ci-cache.json`) of GitHub Actions plugin-CI status. When iterating on the CI-penalty calculation, delete the cache file before re-running locally.
- **`SIGNALK_REGISTRY_TEST=1` is a public contract.** Plugin authors set this env var in their tests to opt out of CI-incompatible assertions. Renaming or removing it silently breaks every plugin that uses it.
