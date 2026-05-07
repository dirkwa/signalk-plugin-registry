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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PLUGIN_KEYWORD = 'signalk-node-server-plugin';
const NPM_SEARCH_SIZE = 250;
async function searchNpm(keyword, from = 0) {
    const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${keyword}&size=${NPM_SEARCH_SIZE}&from=${from}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`npm search returned ${res.status}`);
    return res.json();
}
async function discoverFromNpm() {
    const plugins = [];
    let from = 0;
    while (true) {
        console.error(`[discover] Searching npm from=${from}...`);
        const result = await searchNpm(PLUGIN_KEYWORD, from);
        for (const obj of result.objects) {
            const pkg = obj.package;
            plugins.push({
                name: pkg.name,
                version: pkg.version,
                description: pkg.description || '',
                category: inferCategory(pkg.keywords || []),
                keywords: pkg.keywords || [],
                homepage: pkg.links?.homepage,
                repository: pkg.links?.repository
            });
        }
        from += result.objects.length;
        if (from >= result.total || result.objects.length === 0)
            break;
    }
    console.error(`[discover] Found ${plugins.length} plugins on npm`);
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
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
