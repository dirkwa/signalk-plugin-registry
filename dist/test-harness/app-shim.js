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
function createAppShim(pluginId) {
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
            appPath: tmpDir,
            version: '2.24.0',
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
    const cleanup = () => {
        for (const handler of onStopHandlers)
            handler();
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    };
    return { app: proxiedApp, captured, cleanup };
}
