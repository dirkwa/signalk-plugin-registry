import * as fs from 'fs'
import * as path from 'path'

interface SlotResult {
  tested: string
  server_version?: string
  server_sha?: string
  composite: number
  badges: string[]
  installs: boolean
  loads?: boolean
  activates?: boolean
  detected_providers?: string[]
  unstubbed_accesses?: string[]
  has_schema?: boolean
  has_own_tests?: boolean
  own_tests_pass?: boolean
  has_install_scripts?: boolean
  has_changelog?: boolean
  has_screenshots?: boolean
  audit_critical?: number
  audit_high?: number
  audit_moderate?: number
  activation_error?: string
  install_error?: string
  [key: string]: unknown
}

interface VersionData {
  outdated?: boolean
  superseded_by?: string
  [slotKey: string]: SlotResult | boolean | string | undefined
}

interface PluginResults {
  [pluginName: string]: {
    [version: string]: VersionData
  }
}

interface PluginSummary {
  name: string
  version: string
  composite_stable: number
  badges_stable: string[]
  test_status: string
  composite_master?: number
  badges_master?: string[]
  last_tested: string
  installs: boolean
  loads: boolean
  activates: boolean
  providers: string[]
  error?: string
}

function main() {
  const rootDir = process.cwd()
  const resultsPath = path.join(rootDir, 'results.json')
  const results: PluginResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  const apiDir = path.join(rootDir, 'api')
  const pluginsDir = path.join(apiDir, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })

  const summaries: PluginSummary[] = []

  for (const [pluginName, versions] of Object.entries(results)) {
    // Find latest non-outdated version
    const latestVersion = Object.entries(versions)
      .filter(([_, data]) => !data.outdated)
      .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
      .map(([v]) => v)[0]

    if (!latestVersion) continue

    const versionData = versions[latestVersion]
    const stableResult = versionData['server@stable'] as SlotResult | undefined
    const masterResult = versionData['server@master'] as SlotResult | undefined

    if (!stableResult || typeof stableResult !== 'object') continue

    const summary: PluginSummary = {
      name: pluginName,
      version: latestVersion,
      composite_stable: stableResult.composite || 0,
      badges_stable: stableResult.badges || [],
      test_status: (stableResult.test_status as string) || 'none',
      last_tested: stableResult.tested || '',
      installs: stableResult.installs || false,
      loads: !!stableResult.loads,
      activates: !!stableResult.activates,
      providers: (stableResult.detected_providers as string[]) || [],
      error: (stableResult.load_error as string) || (stableResult.activation_error as string) || (stableResult.install_error as string) || undefined
    }

    if (masterResult && typeof masterResult === 'object') {
      summary.composite_master = masterResult.composite || 0
      summary.badges_master = masterResult.badges || []
    }

    summaries.push(summary)

    // Write per-plugin detail file
    const pluginDetail = {
      name: pluginName,
      versions: Object.fromEntries(
        Object.entries(versions).map(([ver, data]) => {
          const clean = { ...data }
          return [ver, clean]
        })
      )
    }

    const safeFilename = pluginName.replace(/^@/, '').replace(/\//g, '__')
    fs.writeFileSync(
      path.join(pluginsDir, `${safeFilename}.json`),
      JSON.stringify(pluginDetail, null, 2) + '\n'
    )
  }

  // Sort by composite score descending
  summaries.sort((a, b) => b.composite_stable - a.composite_stable)

  // Find server version from first result
  let serverVersion = '?'
  for (const [, versions] of Object.entries(results)) {
    for (const [, data] of Object.entries(versions)) {
      const s = data['server@stable']
      if (s && typeof s === 'object' && (s as SlotResult).server_version) {
        serverVersion = (s as SlotResult).server_version!
        break
      }
    }
    if (serverVersion !== '?') break
  }

  const index = {
    generated: new Date().toISOString(),
    server_version: serverVersion,
    plugin_count: summaries.length,
    plugins: summaries
  }

  fs.writeFileSync(
    path.join(apiDir, 'index.json'),
    JSON.stringify(index, null, 2) + '\n'
  )

  // Generate index.html
  const badgeColors: Record<string, string> = {
    'compatible': '#28a745',
    'loads': '#17a2b8',
    'activates': '#007bff',
    'has-providers': '#6f42c1',
    'tested': '#28a745',
    'tests-failing': '#dc3545',
    'npm-audit-ok': '#28a745',
    'audit-moderate': '#ffc107',
    'audit-high': '#ffc107',
    'audit-critical': '#dc3545',
    'has-changelog': '#17a2b8',
    'has-screenshots': '#17a2b8',
    'broken': '#dc3545'
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function npmUrl(name: string): string {
    return `https://www.npmjs.com/package/${encodeURIComponent(name)}`
  }

  function detailUrl(name: string): string {
    const safe = name.replace(/^@/, '').replace(/\//g, '__')
    return `plugins/${safe}.json`
  }

  function scoreBar(score: number): string {
    const color = score >= 80 ? '#28a745' : score >= 60 ? '#ffc107' : score >= 40 ? '#fd7e14' : '#dc3545'
    return `<div style="display:inline-block;width:60px;height:14px;background:#eee;border-radius:3px;overflow:hidden;vertical-align:middle" title="${score}/100"><div style="width:${score}%;height:100%;background:${color}"></div></div> <strong>${score}</strong>`
  }

  function statusIcon(ok: boolean | undefined): string {
    if (ok === true) return '<span style="color:#28a745">&#10003;</span>'
    if (ok === false) return '<span style="color:#dc3545">&#10007;</span>'
    return '<span style="color:#999">&#8211;</span>'
  }

  function badgeSpan(badge: string): string {
    const bg = badgeColors[badge] || '#6c757d'
    return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${bg};color:#fff;font-size:0.75em;margin:1px">${esc(badge)}</span>`
  }

  function testStatusCell(status: string): string {
    if (status === 'passing') return '<span style="color:#28a745">passing</span>'
    if (status === 'failing') return '<span style="color:#dc3545">failing</span>'
    if (status === 'not-runnable') return '<span style="color:#999" title="Tests exist in source but test runner (jest/mocha/etc) is a devDependency not included in the published package">has tests</span>'
    return '<span style="color:#999">none</span>'
  }

  const passing = summaries.filter(s => s.composite_stable >= 80).length
  const ok = summaries.filter(s => s.composite_stable >= 50 && s.composite_stable < 80).length
  const low = summaries.filter(s => s.composite_stable > 0 && s.composite_stable < 50).length
  const broken = summaries.filter(s => s.composite_stable === 0).length

  const rows = summaries.map((s, i) => {
    const errorCell = s.error
      ? `<span style="color:#dc3545;font-size:0.8em" title="${esc(s.error)}">${esc(s.error.split('\n')[0].slice(0, 60))}${s.error.length > 60 ? '...' : ''}</span>`
      : ''
    const providerCell = s.providers.length > 0
      ? s.providers.map(p => `<span style="display:inline-block;padding:1px 4px;border-radius:2px;background:#e9ecef;font-size:0.75em;margin:1px">${esc(p)}</span>`).join(' ')
      : ''

    return `<tr>
      <td style="text-align:right;color:#999">${i + 1}</td>
      <td>${scoreBar(s.composite_stable)}</td>
      <td><a href="${npmUrl(s.name)}" target="_blank">${esc(s.name)}</a><br><span style="color:#999;font-size:0.8em">${esc(s.version)}</span></td>
      <td style="text-align:center">${statusIcon(s.installs)}</td>
      <td style="text-align:center">${statusIcon(s.loads)}</td>
      <td style="text-align:center">${statusIcon(s.activates)}</td>
      <td style="text-align:center">${testStatusCell(s.test_status)}</td>
      <td>${s.badges_stable.map(b => badgeSpan(b)).join(' ')}</td>
      <td>${providerCell}</td>
      <td>${errorCell}</td>
      <td><a href="${detailUrl(s.name)}" style="font-size:0.8em">json</a></td>
    </tr>`
  }).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signal K Plugin Registry</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; color: #333; }
    h1 { margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 16px; }
    .stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat { padding: 8px 16px; border-radius: 6px; background: #f8f9fa; border: 1px solid #dee2e6; }
    .stat strong { font-size: 1.2em; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th { background: #f8f9fa; position: sticky; top: 0; z-index: 1; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    tr:hover { background: #f8f9fa; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .api-links { margin-bottom: 16px; font-size: 0.9em; }
    .api-links a { margin-right: 12px; }
  </style>
</head>
<body>
  <h1>Signal K Plugin Registry</h1>
  <p class="subtitle">Automated compatibility testing for ${summaries.length} Signal K server plugins &mdash; generated ${new Date().toISOString().split('T')[0]}</p>

  <div class="stats">
    <div class="stat"><strong style="color:#28a745">${passing}</strong> score &ge; 80</div>
    <div class="stat"><strong style="color:#ffc107">${ok}</strong> score 50&ndash;79</div>
    <div class="stat"><strong style="color:#fd7e14">${low}</strong> score 1&ndash;49</div>
    <div class="stat"><strong style="color:#dc3545">${broken}</strong> broken</div>
    <div class="stat">Tested against <strong>server v${index.server_version || '?'}</strong> on Node 24</div>
  </div>

  <div class="api-links">
    <a href="guide.html"><strong>Plugin Quality Guide</strong></a> &middot;
    API: <a href="index.json">index.json</a> &middot;
    <a href="https://github.com/dirkwa/signalk-plugin-registry">GitHub repo</a>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Score</th>
        <th>Plugin</th>
        <th title="npm install succeeds">Inst</th>
        <th title="Constructor returns plugin object">Load</th>
        <th title="start() completes without error">Act</th>
        <th title="Plugin's own test suite">Tests</th>
        <th>Badges</th>
        <th>Providers</th>
        <th>Error</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`

  fs.writeFileSync(path.join(apiDir, 'index.html'), html)

  generateGuide(apiDir)

  console.log(`Built API: ${summaries.length} plugins`)
  for (const s of summaries) {
    console.log(`  ${s.composite_stable.toString().padStart(3)} ${s.name}@${s.version} [${s.badges_stable.join(', ')}]`)
  }
}

function generateGuide(apiDir: string) {
  const guide = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugin Quality Guide - Signal K Plugin Registry</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px auto; max-width: 800px; color: #333; line-height: 1.6; }
    h1 { margin-bottom: 4px; }
    h2 { border-bottom: 1px solid #dee2e6; padding-bottom: 6px; margin-top: 32px; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; margin: 12px 0; }
    th { background: #f8f9fa; }
    th, td { padding: 6px 10px; border: 1px solid #dee2e6; text-align: left; }
    code { background: #f1f3f5; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 12px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; }
    pre code { background: none; padding: 0; }
    .back { font-size: 0.9em; margin-bottom: 16px; }
    .tip { background: #e8f5e9; border-left: 4px solid #28a745; padding: 8px 12px; margin: 12px 0; border-radius: 0 4px 4px 0; }
  </style>
</head>
<body>
  <div class="back"><a href="index.html">&larr; Back to results</a></div>
  <h1>Plugin Quality Guide</h1>
  <p>Practical tips to improve your Signal K plugin's registry score. Most fixes take less than 5 minutes.</p>

  <h2>Scoring Breakdown</h2>
  <table>
    <thead><tr><th>Tier</th><th>Points</th><th>How to pass</th></tr></thead>
    <tbody>
      <tr><td>Install</td><td>20</td><td><code>npm install --ignore-scripts</code> succeeds</td></tr>
      <tr><td>Load</td><td>15</td><td>Module exports a function that returns <code>{id, name, start, stop}</code></td></tr>
      <tr><td>Activate</td><td>15</td><td><code>start(config)</code> completes without error &mdash; config is populated from your schema defaults</td></tr>
      <tr><td>Schema</td><td>5</td><td><code>plugin.schema</code> returns a JSON Schema object</td></tr>
      <tr><td>Tests</td><td>25</td><td><code>npm test</code> passes (biggest single tier &mdash; see below)</td></tr>
      <tr><td>Security</td><td>20</td><td><code>npm audit</code> finds no high or critical vulnerabilities</td></tr>
      <tr><td>Changelog</td><td>&minus;5 if missing</td><td>Ship a <code>CHANGELOG.md</code> or publish a <a href="https://github.com/SignalK/signalk-server/pull/2615" target="_blank">GitHub Release</a> matching the version tag</td></tr>
      <tr><td>Screenshots</td><td>&minus;5 if missing</td><td>Declare <code>signalk.screenshots</code> (array of package-relative paths) in <code>package.json</code></td></tr>
    </tbody>
  </table>

  <h2>Quick Wins</h2>

  <h3>1. Ship release notes (avoid &minus;5)</h3>
  <p>The registry looks for a <code>CHANGELOG.md</code> in the published package first, and falls back to the public GitHub Releases feed for the repo &mdash; so either path works. The <a href="https://github.com/SignalK/signalk-server/pull/2615" target="_blank">recommended</a> approach is GitHub Releases driven by a tag push, with <code>softprops/action-gh-release@v2</code> and <code>generate_release_notes: true</code>. A plain <code>CHANGELOG.md</code> at the repo root (Keep a Changelog style) is equally accepted.</p>

  <h3>2. Add screenshots (avoid &minus;5)</h3>
  <p>Declare them in <code>package.json</code>:</p>
  <pre><code>"signalk": {
  "displayName": "My Plugin",
  "appIcon": "./assets/icon-128.png",
  "screenshots": [
    "./docs/screenshots/main.png",
    "./docs/screenshots/config.png"
  ]
}</code></pre>
  <p>Paths must be package-relative and the files must be included in the published tarball (check your <code>files</code> field or <code>.npmignore</code>). The AppStore shows the first screenshot as the hero image.</p>

  <h3>3. Fix npm audit issues</h3>
  <pre><code>npm audit
npm audit fix</code></pre>
  <p>Most issues come from transitive dependencies. Update your direct dependencies first. If a vulnerability is in a deep transitive dep you don't control, consider whether you really need that dependency.</p>

  <h3>4. Add schema defaults</h3>
  <p>Every property in your schema should have a <code>default</code> value. The registry extracts these and passes them to <code>start()</code>. If your plugin crashes without them, it loses 15 points.</p>
  <pre><code>schema: {
  type: 'object',
  properties: {
    interval: {
      type: 'number',
      title: 'Update interval (seconds)',
      default: 60
    }
  }
}</code></pre>
  <p>See <a href="https://demo.signalk.org/documentation/develop/plugins/configuration.html">Plugin Configuration &amp; Schemas</a> for full details.</p>

  <h3>5. Guard start() against missing config</h3>
  <p>Even with schema defaults, defensive coding helps:</p>
  <pre><code>start(config) {
  const interval = config.interval ?? 60
  const items = config.items || []
}</code></pre>

  <h2>Adding Tests (25 points)</h2>
  <p>The registry clones your source repo and runs <code>npm test</code>. The easiest approach uses Node's built-in test runner &mdash; zero dependencies needed.</p>

  <h3>TypeScript (recommended)</h3>
  <p>Create <code>test/plugin.test.ts</code>:</p>
  <pre><code>import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import pluginFactory from '../src/index'

describe('plugin', () => {
  const app = { debug: () => {}, error: () => {} } as any
  const plugin = pluginFactory(app)

  it('has required interface', () => {
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
    assert.ok(plugin.id)
  })

  it('starts and stops without error', () => {
    plugin.start({}, () => {})
    plugin.stop()
  })
})</code></pre>
  <p>Add to <code>package.json</code>:</p>
  <pre><code>"scripts": {
  "build": "tsc",
  "test": "tsc &amp;&amp; node --test dist/test/plugin.test.js"
}</code></pre>
  <p>The registry clones your source repo, runs <code>npm install</code> and <code>npm run build</code>, then <code>npm test</code> &mdash; so <code>typescript</code> from your devDependencies is available.</p>

  <h3>JavaScript</h3>
  <p>Create <code>test/plugin.test.js</code>:</p>
  <pre><code>const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const pluginFactory = require('../plugin/index.js')

describe('plugin', () => {
  const app = { debug: () => {}, error: () => {} }
  const plugin = pluginFactory(app)

  it('has required interface', () => {
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
    assert.ok(plugin.id)
  })

  it('starts and stops without error', () => {
    plugin.start({}, () => {})
    plugin.stop()
  })
})</code></pre>
  <p>Add to <code>package.json</code>:</p>
  <pre><code>"scripts": {
  "test": "node --test test/plugin.test.js"
}</code></pre>

  <div class="tip">~15 lines, no devDependencies, worth 25 points. Extend with tests for your actual plugin logic from here.</div>
  <p><strong>Why node:test?</strong> Published npm packages don't include devDependencies, so jest/mocha won't be available when the registry installs your plugin. The registry clones your source repo to run tests, but <code>node:test</code> is built into Node and always available.</p>

  <h2>Common Issues</h2>

  <h3>activation error: Cannot read properties of undefined</h3>
  <p>Your <code>start()</code> assumes config has nested objects that don't exist yet. Add <code>default</code> values to nested properties in your schema, or use optional chaining (<code>config.options?.speed ?? 5</code>).</p>

  <h3>tests: not-runnable</h3>
  <p>Your test runner (jest, mocha, vitest) isn't installed because devDependencies aren't available. Switch to <code>node:test</code> (built-in) or ensure the test command works after a fresh <code>npm install</code>.</p>

  <h3>audit-high or audit-critical</h3>
  <p>Run <code>npm audit</code> locally. Usually it's a transitive dependency. Try <code>npm audit fix</code> or update the parent dependency that pulls it in.</p>

  <h3>Score didn't improve after a fix?</h3>
  <p>The registry retests when a new version is published to npm. Bump your version and publish. Alternatively, results older than 7 days are automatically retested on the nightly run.</p>

  <h2>Further Reading</h2>
  <ul>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/">Signal K Plugin Development</a></li>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/configuration.html">Plugin Configuration &amp; Schemas</a></li>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/publishing.html">Publishing to the AppStore</a></li>
    <li><a href="https://nodejs.org/docs/latest-v24.x/api/test.html">Node.js 24 Test Runner documentation</a></li>
    <li><a href="https://github.com/dirkwa/signalk-plugin-registry">Registry source code</a></li>
  </ul>

  <div class="back" style="margin-top: 32px"><a href="index.html">&larr; Back to results</a></div>
</body>
</html>`

  fs.writeFileSync(path.join(apiDir, 'guide.html'), guide)
}

main()
