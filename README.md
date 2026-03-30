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
| Activate | `start({})` completes without error | 15 |
| Schema | Plugin exposes a JSON configuration schema | 5 |
| Tests | Plugin's own test suite passes | 25 |
| Security | No critical or high npm audit vulnerabilities | 20 |

Provider detection (resources, weather, history, autopilot, radar) is tracked as an informational badge but does not affect the score — most plugins are not expected to register providers.

## Badges

| Badge | Meaning |
|-------|---------|
| `compatible` | Installs successfully |
| `loads` | Plugin constructor succeeds |
| `activates` | `start()` completes without error (with empty config) |
| `has-providers` | Registers at least one provider (informational) |
| `tested` | Plugin has its own test suite and it passes |
| `tests-failing` | Plugin has tests but they fail (-5 penalty) |
| `secure` | No critical or high npm audit vulnerabilities |
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

## Known Limitations

- Plugins that need real hardware (CAN bus, serial ports) will not activate
- Plugins that require credentials or external services in config will not activate
- `start({})` with empty config fails for most plugins — this is expected and scored accordingly
- The app shim logs unstubbed method accesses — check `unstubbed_accesses` in results to identify shim gaps
