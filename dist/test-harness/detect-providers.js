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
exports.detectProviders = detectProviders;
const path = __importStar(require("path"));
const app_shim_1 = require("./app-shim");
const schema_defaults_1 = require("./schema-defaults");
const START_TIMEOUT_MS = 10_000;
async function loadPlugin(pluginPath, app) {
    try {
        const resolved = require.resolve(pluginPath);
        delete require.cache[resolved];
        let moduleExport = require(resolved);
        if (moduleExport.__esModule && moduleExport.default) {
            moduleExport = moduleExport.default;
        }
        if (typeof moduleExport !== 'function') {
            return {
                plugin: {},
                loadError: `Module does not export a constructor function (got ${typeof moduleExport})`
            };
        }
        const plugin = moduleExport(app);
        if (!plugin || typeof plugin !== 'object') {
            return {
                plugin: {},
                loadError: `Constructor did not return a plugin object (got ${typeof plugin})`
            };
        }
        return { plugin };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { plugin: {}, loadError: msg };
    }
}
async function detectProviders(pluginPath) {
    const resolvedPath = path.resolve(pluginPath);
    let pkgJson = {};
    try {
        pkgJson = require(path.join(resolvedPath, 'package.json'));
    }
    catch { }
    const shimPluginId = (pkgJson.name || path.basename(resolvedPath))
        .replace(/^@/, '')
        .replace(/\//g, '-');
    const { app, captured, cleanup } = (0, app_shim_1.createAppShim)(shimPluginId);
    const { plugin, loadError } = await loadPlugin(resolvedPath, app);
    if (loadError) {
        const result = buildResult(shimPluginId, plugin, captured, false, loadError, undefined, undefined);
        cleanup();
        return result;
    }
    const rawSchema = plugin.schema;
    const schema = typeof rawSchema === 'function' ? rawSchema() : rawSchema;
    const defaults = (0, schema_defaults_1.extractSchemaDefaults)(schema);
    async function tryStart(config) {
        try {
            const startFn = plugin.start;
            if (typeof startFn === 'function') {
                const startResult = startFn.call(plugin, config, () => { });
                if (startResult && typeof startResult.then === 'function') {
                    await Promise.race([
                        startResult,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('start() timeout')), START_TIMEOUT_MS))
                    ]);
                }
            }
            return undefined;
        }
        catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }
    async function tryStop() {
        try {
            const stopFn = plugin.stop;
            if (typeof stopFn === 'function') {
                const stopResult = stopFn.call(plugin);
                if (stopResult && typeof stopResult.then === 'function') {
                    await Promise.race([
                        stopResult,
                        new Promise((resolve) => setTimeout(resolve, 5000))
                    ]);
                }
            }
        }
        catch { }
    }
    const activationError = await tryStart(defaults);
    await tryStop();
    const activationWithoutConfigError = await tryStart({});
    await tryStop();
    const result = buildResult(shimPluginId, plugin, captured, true, undefined, activationError, activationWithoutConfigError);
    cleanup();
    return result;
}
function buildResult(pluginId, plugin, captured, loads, loadError, activationError, activationWithoutConfigError) {
    const providers = Object.entries(captured.providers)
        .filter(([_, v]) => v !== undefined)
        .map(([k]) => k);
    const activates = loads && !activationError;
    return {
        pluginId,
        pluginName: plugin.name || pluginId,
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
    };
}
if (require.main === module) {
    const pluginPath = process.argv[2];
    if (!pluginPath) {
        console.error('Usage: ts-node detect-providers.ts <plugin-path>');
        process.exit(1);
    }
    detectProviders(pluginPath)
        .then((result) => {
        console.log(JSON.stringify(result, null, 2));
    })
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
