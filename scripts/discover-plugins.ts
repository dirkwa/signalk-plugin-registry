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

async function fetchLatestVersion(
  npmName: string
): Promise<{ version: string; description: string; keywords: string[]; homepage?: string; repository?: string } | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(npmName)}/latest`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return {
      version: data.version,
      description: data.description || '',
      keywords: data.keywords || [],
      homepage: data.homepage,
      repository: typeof data.repository === 'string' ? data.repository : data.repository?.url
    }
  } catch {
    return null
  }
}

async function main() {
  const registryPath = path.resolve(__dirname, '..', 'registry.json')
  const registry: { plugins: RegistryEntry[] } = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))

  const plugins: PluginInfo[] = []

  for (const entry of registry.plugins) {
    const info = await fetchLatestVersion(entry.npm)
    if (info) {
      plugins.push({
        name: entry.npm,
        version: info.version,
        description: info.description,
        category: entry.category,
        keywords: info.keywords,
        homepage: info.homepage,
        repository: info.repository
      })
    } else {
      console.error(`[discover] Failed to fetch ${entry.npm} from npm`)
    }
  }

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
