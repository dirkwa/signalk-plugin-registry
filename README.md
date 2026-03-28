# Signal K Plugin Registry

Automated testing and quality scoring for Signal K server plugins.

## What It Does

- Discovers Signal K plugins from npm (keyword: `signalk-node-server-plugin`)
- Tests each plugin against Signal K server: install, load, activate, detect providers, security audit
- Stores results persistently in `results.json` — only retests on version changes
- Publishes a static JSON API via GitHub Pages
- Runs nightly or on manual trigger

## Test Tiers

| Tier | What | Points |
|------|------|--------|
| 0 | Install (`npm install --ignore-scripts`) | 15 |
| 1a | Load (constructor returns plugin object) | 15 |
| 1b | Activate (`start({})` completes without error) | 15 |
| 2 | Provider detection (resources, weather, history, autopilot, radar) | 10 |
| 3 | JSON Schema present | 5 |
| 4 | Plugin's own tests pass | 20 |
| 5 | Security audit (no critical/high vulnerabilities) | 20 |

Maximum score: **100**

## Badges

| Badge | Meaning |
|-------|---------|
| `compatible` | Installs successfully |
| `loads` | Plugin constructor succeeds |
| `activates` | `start()` completes without error (with empty config) |
| `has-providers` | Registers at least one provider (ResourceProvider, WeatherProvider, etc.) |
| `tested` | Plugin has its own test suite and it passes |
| `secure` | No critical or high npm audit vulnerabilities |
| `broken` | Failed to install |

## API

After the nightly run, results are published to GitHub Pages:

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

## Adding a Plugin

Edit `registry.json` and add the npm package name. The nightly scan will pick it up.
Eventually, full npm keyword search replaces the manual seed list.
