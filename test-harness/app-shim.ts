import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface CapturedRegistrations {
  providers: {
    history?: unknown
    weather?: unknown
    autopilot?: unknown
    resources?: unknown
    radar?: unknown
  }
  putHandlers: Array<{ context: string; path: string }>
  httpRoutes: string[]
  unstubbedAccesses: string[]
  statusMessages: string[]
  errorMessages: string[]
  deltas: unknown[]
}

function createMockBus() {
  const bus: Record<string, unknown> = {}
  const chainMethods = [
    'onValue', 'onError', 'onEnd', 'skipDuplicates', 'map', 'filter',
    'take', 'first', 'toPromise', 'flatMap', 'flatMapLatest', 'merge',
    'debounce', 'debounceImmediate', 'throttle', 'delay',
    'bufferWithTime', 'bufferWithCount', 'combine', 'sampledBy',
    'scan', 'fold', 'zip', 'awaiting', 'not', 'log', 'doAction',
    'doLog', 'doError', 'doEnd', 'withHandler', 'name', 'withDescription',
    'skip', 'slidingWindow', 'startWith', 'mapEnd', 'skipWhile',
    'takeWhile', 'takeUntil', 'errors', 'mapError'
  ]
  for (const m of chainMethods) {
    bus[m] = (..._args: unknown[]) => bus
  }
  bus.onValue = (_cb: unknown) => () => {}
  bus.push = () => {}
  bus.plug = () => () => {}
  bus.end = () => {}
  return bus
}

export function createAppShim(pluginId: string): {
  app: unknown
  captured: CapturedRegistrations
  cleanup: () => void
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-plugin-test-'))
  const configPath = tmpDir
  const dataDir = path.join(tmpDir, 'plugin-config-data', pluginId)
  fs.mkdirSync(dataDir, { recursive: true })

  const captured: CapturedRegistrations = {
    providers: {},
    putHandlers: [],
    httpRoutes: [],
    unstubbedAccesses: [],
    statusMessages: [],
    errorMessages: [],
    deltas: []
  }

  const signalkModel: Record<string, unknown> = {
    self: {},
    vessels: {}
  }

  const onStopHandlers: Array<() => void> = []

  const app = {
    getSelfPath: (_path: string) => undefined,
    getPath: (_path: string) => undefined,
    getMetadata: (_path: string) => undefined,
    putSelfPath: (
      _path: string,
      _value: unknown,
      cb?: (result: { state: string }) => void
    ) => {
      cb?.({ state: 'COMPLETED' })
    },
    putPath: (
      _path: string,
      _value: unknown,
      cb?: (result: { state: string }) => void
    ) => {
      cb?.({ state: 'COMPLETED' })
    },
    queryRequest: (_requestId: string) => Promise.resolve({ state: 'COMPLETED' }),

    handleMessage: (id: string, delta: unknown) => {
      captured.deltas.push({ id, delta })
    },

    setPluginStatus: (msg: string) => {
      captured.statusMessages.push(msg)
    },
    setPluginError: (msg: string) => {
      captured.errorMessages.push(msg)
    },

    savePluginOptions: (
      config: unknown,
      cb?: () => void
    ) => {
      const configFile = path.join(tmpDir, 'plugin-config-data', `${pluginId}.json`)
      fs.writeFileSync(configFile, JSON.stringify(config))
      cb?.()
    },
    readPluginOptions: () => {
      const configFile = path.join(tmpDir, 'plugin-config-data', `${pluginId}.json`)
      if (fs.existsSync(configFile)) {
        return JSON.parse(fs.readFileSync(configFile, 'utf-8'))
      }
      return {}
    },
    getPluginOptions: () => ({}),
    getDataDirPath: () => dataDir,

    debug: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},

    registerPutHandler: (context: string, skPath: string, _callback: unknown, _source?: string) => {
      captured.putHandlers.push({ context, path: skPath })
      const deregister = () => {}
      onStopHandlers.push(deregister)
      return deregister
    },

    registerDeltaInputHandler: (_handler: unknown) => {
      return () => {}
    },

    registerHistoryProvider: (provider: unknown) => {
      captured.providers.history = provider
      onStopHandlers.push(() => { captured.providers.history = undefined })
    },
    registerHistoryApiProvider: (provider: unknown) => {
      captured.providers.history = provider
      onStopHandlers.push(() => { captured.providers.history = undefined })
    },
    registerWeatherProvider: (provider: unknown) => {
      captured.providers.weather = provider
      onStopHandlers.push(() => { captured.providers.weather = undefined })
    },
    registerAutopilotProvider: (provider: unknown, _devices?: string[]) => {
      captured.providers.autopilot = provider
      onStopHandlers.push(() => { captured.providers.autopilot = undefined })
    },
    registerResourceProvider: (provider: unknown) => {
      captured.providers.resources = provider
      onStopHandlers.push(() => { captured.providers.resources = undefined })
    },
    registerRadarProvider: (provider: unknown) => {
      captured.providers.radar = provider
      onStopHandlers.push(() => { captured.providers.radar = undefined })
    },

    streambundle: {
      getSelfBus: (_path: string) => createMockBus(),
      getBus: (_path: string) => createMockBus(),
      getSelfStream: (_path: string) => createMockBus(),
      getAvailablePaths: () => []
    },

    subscriptionmanager: {
      subscribe: (
        _msg: unknown,
        unsubscribes: Array<() => void>,
        _errorCb: unknown,
        _deltaCb: unknown
      ) => {
        const unsub = () => {}
        unsubscribes?.push(unsub)
      }
    },

    signalk: signalkModel,
    selfId: 'urn:mrn:signalk:uuid:00000000-0000-0000-0000-000000000000',
    selfType: 'vessels',
    selfContext: 'vessels.urn:mrn:signalk:uuid:00000000-0000-0000-0000-000000000000',

    config: {
      configPath,
      appPath: tmpDir,
      version: '2.24.0',
      name: 'signalk-server',
      basePath: '/signalk/v1',
      defaults: {}
    },

    on: (_event: string, _handler: unknown) => {},
    once: (_event: string, _handler: unknown) => {},
    emit: (_event: string, ..._args: unknown[]) => {},
    removeListener: (_event: string, _handler: unknown) => {},
    removeAllListeners: (_event?: string) => {},

    getSerialPorts: () => Promise.resolve({}),

    wrappedEmitter: {
      bindMethodsById: (_id: string) => ({
        on: () => {},
        removeListener: () => {}
      })
    },

    reportOutputMessages: (_count?: number) => {},

    resourcesApi: {
      register: (_pluginId: string, provider: unknown) => {
        captured.providers.resources = provider
      }
    },
    weatherApi: {
      register: (_pluginId: string, provider: unknown) => {
        captured.providers.weather = provider
      }
    },
    autopilotApi: {
      register: (_pluginId: string, provider: unknown, _devices?: string[]) => {
        captured.providers.autopilot = provider
      }
    }
  }

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (typeof prop === 'symbol') return undefined
      const propStr = String(prop)
      if (!captured.unstubbedAccesses.includes(propStr)) {
        captured.unstubbedAccesses.push(propStr)
      }
      return (..._args: unknown[]) => {}
    }
  }

  const proxiedApp = new Proxy(app as Record<string, unknown>, handler)

  const cleanup = () => {
    for (const handler of onStopHandlers) handler()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }

  return { app: proxiedApp, captured, cleanup }
}
