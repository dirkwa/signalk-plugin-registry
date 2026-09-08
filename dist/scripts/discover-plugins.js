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
exports.PLUGIN_KEYWORD = void 0;
exports.fetchPackument = fetchPackument;
exports.packumentToPluginInfo = packumentToPluginInfo;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.PLUGIN_KEYWORD = 'signalk-node-server-plugin';
const NPM_SEARCH_SIZE = 250;
// The /-/v1/search endpoint's index lags publishes by up to an hour. Use it
// only to enumerate plugin *names*; resolve each package's authoritative
// version (and metadata) via the per-package endpoint, which has no lag.
const NPM_PACKAGE_FETCH_CONCURRENCY = 16;
async function searchNpm(keyword, from = 0) {
    const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${keyword}&size=${NPM_SEARCH_SIZE}&from=${from}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`npm search returned ${res.status}`);
    return res.json();
}
async function fetchPackument(name) {
    // One transient fetch reject or malformed JSON must not halt all 450+
    // plugins — drop the failing entry and let the rest succeed.
    try {
        const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`[discover] packument fetch ${res.status} for ${name}`);
            return null;
        }
        return (await res.json());
    }
    catch (err) {
        console.error(`[discover] packument fetch error for ${name}:`, err);
        return null;
    }
}
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
async function discoverNames() {
    const names = [];
    let from = 0;
    while (true) {
        console.error(`[discover] Searching npm from=${from}...`);
        const result = await searchNpm(exports.PLUGIN_KEYWORD, from);
        for (const obj of result.objects) {
            names.push(obj.package.name);
        }
        from += result.objects.length;
        if (from >= result.total || result.objects.length === 0)
            break;
    }
    console.error(`[discover] Found ${names.length} plugin names on npm`);
    return names;
}
function packumentToPluginInfo(name, doc) {
    const latest = doc['dist-tags']?.latest;
    if (!latest) {
        console.error(`[discover] ${name} has no dist-tags.latest, skipping`);
        return null;
    }
    const versionDoc = doc.versions?.[latest];
    const keywords = versionDoc?.keywords ?? [];
    const repository = typeof doc.repository === 'string' ? doc.repository : doc.repository?.url;
    return {
        name,
        version: latest,
        description: versionDoc?.description ?? doc.description ?? '',
        category: inferCategory(keywords),
        keywords,
        homepage: doc.homepage,
        repository
    };
}
async function discoverFromNpm() {
    const names = await discoverNames();
    console.error(`[discover] Resolving authoritative versions via per-package endpoint (concurrency=${NPM_PACKAGE_FETCH_CONCURRENCY})...`);
    const packuments = await mapWithConcurrency(names, NPM_PACKAGE_FETCH_CONCURRENCY, fetchPackument);
    const plugins = [];
    for (let i = 0; i < names.length; i++) {
        const doc = packuments[i];
        if (!doc)
            continue;
        const info = packumentToPluginInfo(names[i], doc);
        if (info)
            plugins.push(info);
    }
    console.error(`[discover] Resolved ${plugins.length} plugins`);
    return plugins;
}
function inferCategory(keywords) {
    const kw = keywords.map((k) => k.toLowerCase());
    if (kw.some((k) => k.includes('chart')))
        return 'charts';
    if (kw.some((k) => k.includes('anchor') || k.includes('alarm') || k.includes('safety')))
        return 'safety';
    if (kw.some((k) => k.includes('notification')))
        return 'notifications';
    if (kw.some((k) => k.includes('instrument') || k.includes('dashboard')))
        return 'instruments';
    if (kw.some((k) => k.includes('ais')))
        return 'ais';
    if (kw.some((k) => k.includes('nmea') || k.includes('n2k')))
        return 'nmea';
    if (kw.some((k) => k.includes('weather')))
        return 'weather';
    if (kw.some((k) => k.includes('autopilot')))
        return 'autopilot';
    if (kw.some((k) => k.includes('mqtt') || k.includes('cloud') || k.includes('influx')))
        return 'integration';
    if (kw.some((k) => k.includes('log')))
        return 'logging';
    return 'other';
}
async function main() {
    const registryPath = path.resolve(__dirname, '..', 'registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    // Discover all plugins from npm keyword search
    const npmPlugins = await discoverFromNpm();
    // Merge with registry.json seed list (registry entries override category)
    const seedMap = new Map(registry.plugins.map((e) => [e.npm, e.category]));
    const merged = new Map();
    for (const p of npmPlugins) {
        if (seedMap.has(p.name)) {
            p.category = seedMap.get(p.name);
        }
        merged.set(p.name, p);
    }
    // Add any seed entries not found via npm search
    for (const entry of registry.plugins) {
        if (!merged.has(entry.npm)) {
            console.error(`[discover] Seed plugin ${entry.npm} not found on npm, skipping`);
        }
    }
    const plugins = Array.from(merged.values());
    const outIdx = process.argv.indexOf('--out');
    if (outIdx !== -1 && process.argv[outIdx + 1]) {
        fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(plugins, null, 2) + '\n');
        console.error(`[discover] Wrote ${plugins.length} plugins to ${process.argv[outIdx + 1]}`);
    }
    else {
        console.log(JSON.stringify(plugins, null, 2));
    }
}
if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
