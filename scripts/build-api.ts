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
    API: <a href="index.json">index.json</a> (all plugins) &middot;
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

  console.log(`Built API: ${summaries.length} plugins`)
  for (const s of summaries) {
    console.log(`  ${s.composite_stable.toString().padStart(3)} ${s.name}@${s.version} [${s.badges_stable.join(', ')}]`)
  }
}

main()
