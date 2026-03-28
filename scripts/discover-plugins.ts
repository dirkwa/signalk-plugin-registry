import * as fs from 'fs'
import * as path from 'path'

interface RegistryEntry {
  npm: string
  category: string
}

interface PluginInfo {
  name: string
  version: string
  description: string
  category: string
  keywords: string[]
  homepage?: string
  repository?: string
}

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string
      version: string
      description?: string
      keywords?: string[]
      date?: string
      links?: { npm?: string; homepage?: string; repository?: string }
    }
  }>
  total: number
}

const PLUGIN_KEYWORD = 'signalk-node-server-plugin'
const NPM_SEARCH_SIZE = 250

async function searchNpm(keyword: string, from: number = 0): Promise<NpmSearchResult> {
  const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${keyword}&size=${NPM_SEARCH_SIZE}&from=${from}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`npm search returned ${res.status}`)
  return res.json()
}

async function discoverFromNpm(): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = []
  let from = 0

  while (true) {
    console.error(`[discover] Searching npm from=${from}...`)
    const result = await searchNpm(PLUGIN_KEYWORD, from)

    for (const obj of result.objects) {
      const pkg = obj.package
      plugins.push({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description || '',
        category: inferCategory(pkg.keywords || []),
        keywords: pkg.keywords || [],
        homepage: pkg.links?.homepage,
        repository: pkg.links?.repository
      })
    }

    from += result.objects.length
    if (from >= result.total || result.objects.length === 0) break
  }

  console.error(`[discover] Found ${plugins.length} plugins on npm`)
  return plugins
}

function inferCategory(keywords: string[]): string {
  const kw = keywords.map((k) => k.toLowerCase())
  if (kw.some((k) => k.includes('chart'))) return 'charts'
  if (kw.some((k) => k.includes('anchor') || k.includes('alarm') || k.includes('safety')))
    return 'safety'
  if (kw.some((k) => k.includes('notification'))) return 'notifications'
  if (kw.some((k) => k.includes('instrument') || k.includes('dashboard')))
    return 'instruments'
  if (kw.some((k) => k.includes('ais'))) return 'ais'
  if (kw.some((k) => k.includes('nmea') || k.includes('n2k'))) return 'nmea'
  if (kw.some((k) => k.includes('weather'))) return 'weather'
  if (kw.some((k) => k.includes('autopilot'))) return 'autopilot'
  if (kw.some((k) => k.includes('mqtt') || k.includes('cloud') || k.includes('influx')))
    return 'integration'
  if (kw.some((k) => k.includes('log'))) return 'logging'
  return 'other'
}

async function main() {
  const registryPath = path.resolve(__dirname, '..', 'registry.json')
  const registry: { plugins: RegistryEntry[] } = JSON.parse(
    fs.readFileSync(registryPath, 'utf-8')
  )

  // Discover all plugins from npm keyword search
  const npmPlugins = await discoverFromNpm()

  // Merge with registry.json seed list (registry entries override category)
  const seedMap = new Map(registry.plugins.map((e) => [e.npm, e.category]))
  const merged = new Map<string, PluginInfo>()

  for (const p of npmPlugins) {
    if (seedMap.has(p.name)) {
      p.category = seedMap.get(p.name)!
    }
    merged.set(p.name, p)
  }

  // Add any seed entries not found via npm search
  for (const entry of registry.plugins) {
    if (!merged.has(entry.npm)) {
      console.error(`[discover] Seed plugin ${entry.npm} not found on npm, skipping`)
    }
  }

  const plugins = Array.from(merged.values())
  const output = JSON.stringify(plugins)

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `plugins=${output}\n`)
  } else {
    console.log(JSON.stringify(plugins, null, 2))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
