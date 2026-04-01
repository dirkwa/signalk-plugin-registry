import * as path from 'path'
import { createAppShim, CapturedRegistrations } from './app-shim'
import { extractSchemaDefaults } from './schema-defaults'

export interface DetectionResult {
  pluginId: string
  pluginName: string
  providers: string[]
  putHandlers: Array<{ context: string; path: string }>
  httpRoutes: string[]
  unstubbedAccesses: string[]
  loads: boolean
  loadError?: string
  activates: boolean
  activationError?: string
  activatesWithoutConfig: boolean
  activationWithoutConfigError?: string
  statusMessages: string[]
  errorMessages: string[]
  hasSchema: boolean
}

const START_TIMEOUT_MS = 10_000

async function loadPlugin(
  pluginPath: string,
  app: unknown
): Promise<{ plugin: Record<string, unknown>; loadError?: string }> {
  try {
    const resolved = require.resolve(pluginPath)
    delete require.cache[resolved]
    let moduleExport = require(resolved)

    if (moduleExport.__esModule && moduleExport.default) {
      moduleExport = moduleExport.default
    }

    if (typeof moduleExport !== 'function') {
      return {
        plugin: {},
        loadError: `Module does not export a constructor function (got ${typeof moduleExport})`
      }
    }

    const plugin = moduleExport(app)
    if (!plugin || typeof plugin !== 'object') {
      return {
        plugin: {},
        loadError: `Constructor did not return a plugin object (got ${typeof plugin})`
      }
    }

    return { plugin }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { plugin: {}, loadError: msg }
  }
}

export async function detectProviders(pluginPath: string): Promise<DetectionResult> {
  const resolvedPath = path.resolve(pluginPath)

  let pkgJson: Record<string, unknown> = {}
  try {
    pkgJson = require(path.join(resolvedPath, 'package.json'))
  } catch {}

  const shimPluginId = (pkgJson.name as string || path.basename(resolvedPath))
    .replace(/^@/, '')
    .replace(/\//g, '-')

  const { app, captured, cleanup } = createAppShim(shimPluginId)

  const { plugin, loadError } = await loadPlugin(resolvedPath, app)

  if (loadError) {
    const result = buildResult(shimPluginId, plugin, captured, false, loadError, undefined, undefined)
    cleanup()
    return result
  }

  const rawSchema = plugin.schema
  const schema = typeof rawSchema === 'function' ? rawSchema() : rawSchema
  const defaults = extractSchemaDefaults(schema)

  async function tryStart(config: Record<string, unknown>): Promise<string | undefined> {
    try {
      const startFn = (plugin as Record<string, unknown>).start
      if (typeof startFn === 'function') {
        const startResult = startFn.call(plugin, config, () => {})
        if (startResult && typeof (startResult as Promise<void>).then === 'function') {
          await Promise.race([
            startResult,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('start() timeout')), START_TIMEOUT_MS)
            )
          ])
        }
      }
      return undefined
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  async function tryStop() {
    try {
      const stopFn = (plugin as Record<string, unknown>).stop
      if (typeof stopFn === 'function') {
        const stopResult = stopFn.call(plugin)
        if (stopResult && typeof (stopResult as Promise<void>).then === 'function') {
          await Promise.race([
            stopResult,
            new Promise<void>((resolve) => setTimeout(resolve, 5000))
          ])
        }
      }
    } catch {}
  }

  const activationError = await tryStart(defaults)
  await tryStop()

  const activationWithoutConfigError = await tryStart({})
  await tryStop()

  const result = buildResult(
    shimPluginId, plugin, captured, true, undefined,
    activationError, activationWithoutConfigError
  )

  cleanup()
  return result
}

function buildResult(
  pluginId: string,
  plugin: Record<string, unknown>,
  captured: CapturedRegistrations,
  loads: boolean,
  loadError?: string,
  activationError?: string,
  activationWithoutConfigError?: string
): DetectionResult {
  const providers = Object.entries(captured.providers)
    .filter(([_, v]) => v !== undefined)
    .map(([k]) => k)

  const activates = loads && !activationError

  return {
    pluginId,
    pluginName: (plugin.name as string) || pluginId,
    providers,
    putHandlers: captured.putHandlers,
    httpRoutes: captured.httpRoutes,
    unstubbedAccesses: captured.unstubbedAccesses,
    loads,
    loadError,
    activates,
    activationError,
    activatesWithoutConfig: loads && !activationWithoutConfigError,
    activationWithoutConfigError,
    statusMessages: captured.statusMessages,
    errorMessages: captured.errorMessages,
    hasSchema: typeof plugin.schema === 'object' || typeof plugin.schema === 'function'
  }
}

if (require.main === module) {
  const pluginPath = process.argv[2]
  if (!pluginPath) {
    console.error('Usage: ts-node detect-providers.ts <plugin-path>')
    process.exit(1)
  }

  detectProviders(pluginPath)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
