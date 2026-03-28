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
}

function main() {
  const resultsPath = path.resolve(__dirname, '..', 'results.json')
  const results: PluginResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  const apiDir = path.resolve(__dirname, '..', 'api')
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
      providers: (stableResult.detected_providers as string[]) || []
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

  const index = {
    generated: new Date().toISOString(),
    plugin_count: summaries.length,
    plugins: summaries
  }

  fs.writeFileSync(
    path.join(apiDir, 'index.json'),
    JSON.stringify(index, null, 2) + '\n'
  )

  console.log(`Built API: ${summaries.length} plugins`)
  for (const s of summaries) {
    console.log(`  ${s.composite_stable.toString().padStart(3)} ${s.name}@${s.version} [${s.badges_stable.join(', ')}]`)
  }
}

main()
