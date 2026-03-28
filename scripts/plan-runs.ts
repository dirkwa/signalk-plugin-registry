import * as fs from 'fs'
import * as path from 'path'

interface PluginInfo {
  name: string
  version: string
  category: string
}

interface SlotResult {
  server_version?: string
  server_sha?: string
  tested: string
  [key: string]: unknown
}

interface VersionResult {
  outdated?: boolean
  superseded_by?: string
  [serverSlot: string]: SlotResult | boolean | string | undefined
}

interface PluginResults {
  [pluginName: string]: {
    [pluginVersion: string]: VersionResult
  }
}

type TriggerReason =
  | 'nightly'
  | 'plugin_version_change'
  | 'server_version_change'
  | 'schema_change'
  | 'manual'

interface PlannedRun {
  plugin: string
  pluginVersion: string
  server: 'stable' | 'master'
  serverVersion: string
  reason: TriggerReason
}

function shouldTest(
  pluginName: string,
  pluginVersion: string,
  serverSlot: 'stable' | 'master',
  serverVersion: string,
  results: PluginResults,
  force: boolean
): { run: boolean; reason?: TriggerReason } {
  if (force) return { run: true, reason: 'manual' }

  const existing = results[pluginName]?.[pluginVersion]?.[`server@${serverSlot}`]

  if (!existing || typeof existing === 'boolean' || typeof existing === 'string') {
    return { run: true, reason: 'plugin_version_change' }
  }

  const slot = existing as SlotResult
  if (serverSlot === 'stable' && slot.server_version === serverVersion) {
    return { run: false }
  }

  if (serverSlot === 'master') {
    return { run: false }
  }

  return { run: true, reason: 'server_version_change' }
}

function markOutdated(results: PluginResults, pluginName: string, latestVersion: string) {
  const versions = Object.keys(results[pluginName] ?? {})
  for (const v of versions) {
    if (v !== latestVersion && !results[pluginName][v].outdated) {
      results[pluginName][v].outdated = true
      results[pluginName][v].superseded_by = latestVersion
    }
  }
}

function parseArgs(): {
  plugins: PluginInfo[]
  stableVersion: string
  masterSha: string
  mode: string
  pluginFilter: string
  includeMaster: boolean
  isScheduled: boolean
} {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : ''
  }

  const pluginsFile = get('--plugins-file')
  const pluginsJson = get('--plugins')
  let plugins: PluginInfo[]
  if (pluginsFile) {
    plugins = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8'))
  } else {
    plugins = JSON.parse(pluginsJson || '[]')
  }

  return {
    plugins,
    stableVersion: get('--stable-version'),
    masterSha: get('--master-sha'),
    mode: get('--mode') || 'changed_only',
    pluginFilter: get('--plugin-filter') || '',
    includeMaster: get('--include-master') === 'true',
    isScheduled: get('--is-scheduled') === 'true'
  }
}

function main() {
  const args = parseArgs()

  const resultsPath = path.resolve(__dirname, '..', 'results.json')
  const results: PluginResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  let plugins = args.plugins
  if (args.mode === 'single_plugin' && args.pluginFilter) {
    plugins = plugins.filter((p) => p.name === args.pluginFilter)
  }

  const force = args.mode === 'all_plugins'
  const runs: PlannedRun[] = []

  for (const plugin of plugins) {
    markOutdated(results, plugin.name, plugin.version)

    const stableCheck = shouldTest(
      plugin.name,
      plugin.version,
      'stable',
      args.stableVersion,
      results,
      force
    )
    if (stableCheck.run) {
      runs.push({
        plugin: plugin.name,
        pluginVersion: plugin.version,
        server: 'stable',
        serverVersion: args.stableVersion,
        reason: stableCheck.reason!
      })
    }

    if (args.includeMaster) {
      const masterCheck = shouldTest(
        plugin.name,
        plugin.version,
        'master',
        args.masterSha,
        results,
        force
      )
      if (masterCheck.run) {
        runs.push({
          plugin: plugin.name,
          pluginVersion: plugin.version,
          server: 'master',
          serverVersion: args.masterSha,
          reason: masterCheck.reason!
        })
      }
    }
  }

  if (Object.keys(results).length > 0) {
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n')
  }

  // Cap per run — untested plugins are picked up on subsequent runs
  const MAX_MATRIX_JOBS = 50
  if (runs.length > MAX_MATRIX_JOBS) {
    console.error(
      `[plan] Capping ${runs.length} runs to ${MAX_MATRIX_JOBS} (remaining will be picked up in next run)`
    )
    runs.length = MAX_MATRIX_JOBS
  }

  const output = [
    `runs=${JSON.stringify(runs)}`,
    `has_runs=${runs.length > 0}`
  ].join('\n')

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n')
  } else {
    console.log(`Planned ${runs.length} test runs:`)
    for (const run of runs) {
      console.log(`  ${run.plugin}@${run.pluginVersion} x ${run.server} [${run.reason}]`)
    }
  }
}

main()
