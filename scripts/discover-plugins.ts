import * as fs from 'fs'
import * as path from 'path'

interface RegistryEntry {
  npm: string
  category: string
}

export interface PluginInfo {
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
    }
  }>
  total: number
}

export interface NpmPackument {
  name: string
  description?: string
  homepage?: string
  repository?: { url?: string } | string
  'dist-tags'?: { latest?: string } & Record<string, string | undefined>
  versions?: Record<string, { version: string; description?: string; keywords?: string[] }>
}

export const PLUGIN_KEYWORD = 'signalk-node-server-plugin'
const NPM_SEARCH_SIZE = 250
// The /-/v1/search endpoint's index lags publishes by up to an hour. Use it
// only to enumerate plugin *names*; resolve each package's authoritative
// version (and metadata) via the per-package endpoint, which has no lag.
const NPM_PACKAGE_FETCH_CONCURRENCY = 16

async function searchNpm(keyword: string, from: number = 0): Promise<NpmSearchResult> {
  const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${keyword}&size=${NPM_SEARCH_SIZE}&from=${from}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`npm search returned ${res.status}`)
  return res.json()
}

export async function fetchPackument(name: string): Promise<NpmPackument | null> {
  // One transient fetch reject or malformed JSON must not halt all 450+
  // plugins — drop the failing entry and let the rest succeed.
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[discover] packument fetch ${res.status} for ${name}`)
      return null
    }
    return (await res.json()) as NpmPackument
  } catch (err) {
    console.error(`[discover] packument fetch error for ${name}:`, err)
    return null
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

async function discoverNames(): Promise<string[]> {
  const names: string[] = []
  let from = 0
  while (true) {
    console.error(`[discover] Searching npm from=${from}...`)
    const result = await searchNpm(PLUGIN_KEYWORD, from)
    for (const obj of result.objects) {
      names.push(obj.package.name)
    }
    from += result.objects.length
    if (from >= result.total || result.objects.length === 0) break
  }
  console.error(`[discover] Found ${names.length} plugin names on npm`)
  return names
}

export function packumentToPluginInfo(name: string, doc: NpmPackument): PluginInfo | null {
  const latest = doc['dist-tags']?.latest
  if (!latest) {
    console.error(`[discover] ${name} has no dist-tags.latest, skipping`)
    return null
  }
  const versionDoc = doc.versions?.[latest]
  const keywords = versionDoc?.keywords ?? []
  const repository =
    typeof doc.repository === 'string' ? doc.repository : doc.repository?.url
  return {
    name,
    version: latest,
    description: versionDoc?.description ?? doc.description ?? '',
    category: inferCategory(keywords),
    keywords,
    homepage: doc.homepage,
    repository
  }
}

async function discoverFromNpm(): Promise<PluginInfo[]> {
  const names = await discoverNames()
  console.error(
    `[discover] Resolving authoritative versions via per-package endpoint (concurrency=${NPM_PACKAGE_FETCH_CONCURRENCY})...`
  )
  const packuments = await mapWithConcurrency(
    names,
    NPM_PACKAGE_FETCH_CONCURRENCY,
    fetchPackument
  )
  const plugins: PluginInfo[] = []
  for (let i = 0; i < names.length; i++) {
    const doc = packuments[i]
    if (!doc) continue
    const info = packumentToPluginInfo(names[i], doc)
    if (info) plugins.push(info)
  }
  console.error(`[discover] Resolved ${plugins.length} plugins`)
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

  const outIdx = process.argv.indexOf('--out')
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(plugins, null, 2) + '\n')
    console.error(`[discover] Wrote ${plugins.length} plugins to ${process.argv[outIdx + 1]}`)
  } else {
    console.log(JSON.stringify(plugins, null, 2))
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
