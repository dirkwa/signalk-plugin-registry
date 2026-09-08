"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppShim = createAppShim;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function createMockBus() {
    const bus = {};
    const chainMethods = [
        'onValue', 'onError', 'onEnd', 'skipDuplicates', 'map', 'filter',
        'take', 'first', 'toPromise', 'flatMap', 'flatMapLatest', 'merge',
        'debounce', 'debounceImmediate', 'throttle', 'delay',
        'bufferWithTime', 'bufferWithCount', 'combine', 'sampledBy',
        'scan', 'fold', 'zip', 'awaiting', 'not', 'log', 'doAction',
        'doLog', 'doError', 'doEnd', 'withHandler', 'name', 'withDescription',
        'skip', 'slidingWindow', 'startWith', 'mapEnd', 'skipWhile',
        'takeWhile', 'takeUntil', 'errors', 'mapError'
    ];
    for (const m of chainMethods) {
        bus[m] = (..._args) => bus;
    }
    bus.onValue = (_cb) => () => { };
    bus.push = () => { };
    bus.plug = () => () => { };
    bus.end = () => { };
    return bus;
}
// Plugins that gate behaviour on `app.config.version` (e.g.
// `semver.satisfies(app.config.version, '>=2.x')`) should see the server the
// slot actually installed, not a frozen constant. The runner forwards the
// resolved version through `SIGNALK_SERVER_VERSION`. The `master` slot's
// "version" is a 7-char git SHA, which isn't valid semver and would break any
// such check, so we only honour values that look like semver and otherwise
// fall back to the last stable release this harness was pinned to.
const FALLBACK_SERVER_VERSION = '2.24.0';
function resolveServerVersion() {
    const v = process.env.SIGNALK_SERVER_VERSION?.trim();
    return v && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(v) ? v : FALLBACK_SERVER_VERSION;
}
// On a real server `app.config.appPath` is the signalk-server install root,
// and plugins resolve server internals through it (bt-sensors' classLoader
// imports `${appPath}dist/modules.js`). The CI slots install a real server
// and forward its path through `SIGNALK_SERVER_PATH`; without it (local
// dev) the shim keeps its tmpdir. Upstream computes
// `path.normalize(__dirname + '/../../')`, which keeps a trailing
// separator that plugins string-concatenate against — so it is preserved
// here too.
function resolveServerPath() {
    const p = process.env.SIGNALK_SERVER_PATH?.trim();
    if (!p)
        return undefined;
    try {
        if (!fs.statSync(p).isDirectory())
            return undefined;
    }
    catch {
        return undefined;
    }
    return p.endsWith(path.sep) ? p : p + path.sep;
}
function createAppShim(pluginId, options = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-plugin-test-'));
    const configPath = tmpDir;
    const dataDir = path.join(tmpDir, 'plugin-config-data', pluginId);
    fs.mkdirSync(dataDir, { recursive: true });
    const captured = {
        providers: {},
        putHandlers: [],
        httpRoutes: [],
        unstubbedAccesses: [],
        statusMessages: [],
        errorMessages: [],
        deltas: []
    };
    const signalkModel = {
        self: {},
        vessels: {}
    };
    const onStopHandlers = [];
    // A consumer may fire-and-forget a rejecting stub (no await, no .catch).
    // The detection subprocess treats unhandled rejections as fatal
    // (detect-sandboxed.ts), so hand out rejections that already carry a
    // no-op handler — awaiting callers still see the error, but a dangling
    // one can't kill detection and mislabel a loaded plugin as loads: false.
    const preHandledRejection = (err) => {
        const p = Promise.reject(err);
        p.catch(() => { });
        return p;
    };
    const app = {
        getSelfPath: (_path) => undefined,
        getPath: (_path) => undefined,
        getMetadata: (_path) => undefined,
        putSelfPath: (_path, _value, cb) => {
            cb?.({ state: 'COMPLETED' });
        },
        putPath: (_path, _value, cb) => {
            cb?.({ state: 'COMPLETED' });
        },
        queryRequest: (_requestId) => Promise.resolve({ state: 'COMPLETED' }),
        handleMessage: (id, delta) => {
            captured.deltas.push({ id, delta });
        },
        setPluginStatus: (msg) => {
            captured.statusMessages.push(msg);
        },
        setPluginError: (msg) => {
            captured.errorMessages.push(msg);
        },
        savePluginOptions: (config, cb) => {
            const configFile = path.join(tmpDir, 'plugin-config-data', `${pluginId}.json`);
            fs.writeFileSync(configFile, JSON.stringify(config));
            cb?.();
        },
        readPluginOptions: () => {
            const configFile = path.join(tmpDir, 'plugin-config-data', `${pluginId}.json`);
            if (fs.existsSync(configFile)) {
                return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            }
            return {};
        },
        getPluginOptions: () => ({}),
        getDataDirPath: () => dataDir,
        debug: (..._args) => { },
        error: (..._args) => { },
        registerPutHandler: (context, skPath, _callback, _source) => {
            captured.putHandlers.push({ context, path: skPath });
            const deregister = () => { };
            onStopHandlers.push(deregister);
            return deregister;
        },
        registerDeltaInputHandler: (_handler) => {
            return () => { };
        },
        registerHistoryProvider: (provider) => {
            captured.providers.history = provider;
            onStopHandlers.push(() => { captured.providers.history = undefined; });
        },
        registerHistoryApiProvider: (provider) => {
            captured.providers.history = provider;
            onStopHandlers.push(() => { captured.providers.history = undefined; });
        },
        registerWeatherProvider: (provider) => {
            captured.providers.weather = provider;
            onStopHandlers.push(() => { captured.providers.weather = undefined; });
        },
        registerAutopilotProvider: (provider, _devices) => {
            captured.providers.autopilot = provider;
            onStopHandlers.push(() => { captured.providers.autopilot = undefined; });
        },
        registerResourceProvider: (provider) => {
            captured.providers.resources = provider;
            onStopHandlers.push(() => { captured.providers.resources = undefined; });
        },
        registerRadarProvider: (provider) => {
            captured.providers.radar = provider;
            onStopHandlers.push(() => { captured.providers.radar = undefined; });
        },
        registerBLEProvider: (provider) => {
            captured.providers.ble = provider;
            onStopHandlers.push(() => { captured.providers.ble = undefined; });
        },
        streambundle: {
            getSelfBus: (_path) => createMockBus(),
            getBus: (_path) => createMockBus(),
            getSelfStream: (_path) => createMockBus(),
            getAvailablePaths: () => []
        },
        subscriptionmanager: {
            subscribe: (_msg, unsubscribes, _errorCb, _deltaCb) => {
                const unsub = () => { };
                unsubscribes?.push(unsub);
            }
        },
        signalk: signalkModel,
        selfId: 'urn:mrn:signalk:uuid:00000000-0000-0000-0000-000000000000',
        selfType: 'vessels',
        selfContext: 'vessels.urn:mrn:signalk:uuid:00000000-0000-0000-0000-000000000000',
        config: {
            configPath,
            // Both modes end with a separator — the contract plugins rely on
            // when they string-concatenate against appPath.
            appPath: resolveServerPath() ?? tmpDir + path.sep,
            version: resolveServerVersion(),
            name: 'signalk-server',
            basePath: '/signalk/v1',
            defaults: {}
        },
        on: (_event, _handler) => { },
        once: (_event, _handler) => { },
        emit: (_event, ..._args) => { },
        removeListener: (_event, _handler) => { },
        removeAllListeners: (_event) => { },
        getSerialPorts: () => Promise.resolve({}),
        wrappedEmitter: {
            bindMethodsById: (_id) => ({
                on: () => { },
                removeListener: () => { }
            })
        },
        reportOutputMessages: (_count) => { },
        resourcesApi: {
            register: (_pluginId, provider) => {
                captured.providers.resources = provider;
            }
        },
        weatherApi: {
            register: (_pluginId, provider) => {
                captured.providers.weather = provider;
            }
        },
        autopilotApi: {
            register: (_pluginId, provider, _devices) => {
                captured.providers.autopilot = provider;
            }
        },
        // BLE API (server >= 2.31.0). Models a server with the BLE API enabled
        // but no hardware behind it: no adapter managed, no providers, no
        // devices visible. Advertisement subscriptions succeed and never emit;
        // GATT calls reject with upstream's no-provider errors so a consumer
        // plugin fails on its own terms, exactly as on a hardware-less server.
        bleApi: {
            localBluetoothManaged: false,
            register: (_pluginId, provider) => {
                captured.providers.ble = provider;
                onStopHandlers.push(() => { captured.providers.ble = undefined; });
            },
            unRegister: (_pluginId) => {
                captured.providers.ble = undefined;
            },
            onAdvertisement: (_pluginId, _callback) => () => { },
            getDevices: () => Promise.resolve([]),
            getDevice: (_mac) => Promise.resolve(null),
            subscribeGATT: (descriptor, _pluginId, _callback) => {
                const mac = descriptor && typeof descriptor === 'object'
                    ? descriptor.mac
                    : undefined;
                return preHandledRejection(new Error(`No provider with GATT support and available slots can see ${mac}`));
            },
            connectGATT: (mac, _pluginId) => preHandledRejection(new Error(`No provider with GATT support can see ${mac}`)),
            releaseGATTDevice: (_mac, _pluginId) => Promise.resolve(),
            getGATTClaims: () => new Map()
        }
    };
    const handler = {
        get(target, prop) {
            if (prop in target)
                return target[prop];
            if (typeof prop === 'symbol')
                return undefined;
            const propStr = String(prop);
            if (!captured.unstubbedAccesses.includes(propStr)) {
                captured.unstubbedAccesses.push(propStr);
            }
            return (..._args) => { };
        }
    };
    const proxiedApp = new Proxy(app, handler);
    const globalCleanups = [];
    // Install cross-plugin global stubs the plugin's start() may await. The
    // harness never instantiates companion plugins, only the one under test,
    // so without these stubs every consumer plugin that polls
    // globalThis.__signalk_containerManager would time out at activation.
    const requires = options.requires ?? [];
    if (requires.includes('signalk-container')) {
        const sentinelVersionSource = { kind: '__signalk_registry_stub__' };
        const stub = {
            // ContainerRuntimeInfo-shaped enough that the polling pattern
            // `m && m.getRuntime()` resolves truthy. Real plugins read fields
            // off the result (runtime name, version, isPodmanDockerShim, etc.) —
            // their downstream logic typically fails open when those are
            // undefined, which is what we want here.
            getRuntime: () => ({ runtime: 'stub', version: '0.0.0-harness-stub' }),
            whenReady: () => Promise.resolve(),
            // Recreate handlers that may be invoked from start():
            remove: () => Promise.resolve(),
            ensureRunning: () => Promise.resolve(),
            recreate: () => Promise.resolve(),
            getState: () => Promise.resolve({ state: 'missing' }),
            getContainerState: () => Promise.resolve({ state: 'missing' }),
            updates: {
                register: (_reg) => { },
                unregister: (_pluginId) => { },
                checkOne: () => Promise.resolve({ ok: false, fromCache: false }),
                checkAll: () => Promise.resolve([]),
                getLastResult: () => null,
                sources: {
                    githubReleases: (_repo) => sentinelVersionSource,
                    dockerHubTags: (_image) => sentinelVersionSource
                }
            }
        };
        const g = globalThis;
        const priorValue = g.__signalk_containerManager;
        const hadPrior = '__signalk_containerManager' in g;
        g.__signalk_containerManager = stub;
        globalCleanups.push(() => {
            if (hadPrior)
                g.__signalk_containerManager = priorValue;
            else
                delete g.__signalk_containerManager;
        });
    }
    const cleanup = () => {
        for (const handler of onStopHandlers)
            handler();
        for (const c of globalCleanups)
            c();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    };
    return { app: proxiedApp, captured, cleanup };
}
