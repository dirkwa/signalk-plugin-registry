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
function shouldTest(pluginName, pluginVersion, serverSlot, serverVersion, results, force) {
    if (force)
        return { run: true, reason: 'manual' };
    const existing = results[pluginName]?.[pluginVersion]?.[`server@${serverSlot}`];
    if (!existing || typeof existing === 'boolean' || typeof existing === 'string') {
        return { run: true, reason: 'plugin_version_change' };
    }
    const slot = existing;
    // Slots written by older runner versions may be missing fields the
    // current scoring depends on (e.g. has_changelog/has_screenshots
    // were added with the 0.2.0 scoring tier). Re-test instead of leaving
    // the stored composite stale. Extend this list when new fields are
    // added to the runner output.
    const REQUIRED_FIELDS = ['has_changelog', 'has_screenshots'];
    for (const field of REQUIRED_FIELDS) {
        if (slot[field] === undefined) {
            return { run: true, reason: 'schema_change' };
        }
    }
    const STALE_DAYS = 7;
    const ageMs = Date.now() - new Date(slot.tested).getTime();
    if (ageMs > STALE_DAYS * 24 * 60 * 60 * 1000) {
        return { run: true, reason: 'stale' };
    }
    if (serverSlot === 'stable' && slot.server_version === serverVersion) {
        return { run: false };
    }
    if (serverSlot === 'master') {
        return { run: false };
    }
    return { run: true, reason: 'server_version_change' };
}
function markOutdated(results, pluginName, latestVersion) {
    const versions = Object.keys(results[pluginName] ?? {});
    for (const v of versions) {
        if (v !== latestVersion && !results[pluginName][v].outdated) {
            results[pluginName][v].outdated = true;
            results[pluginName][v].superseded_by = latestVersion;
        }
    }
}
function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : '';
    };
    const pluginsFile = get('--plugins-file');
    const pluginsJson = get('--plugins');
    let plugins;
    if (pluginsFile) {
        plugins = JSON.parse(fs.readFileSync(pluginsFile, 'utf-8'));
    }
    else {
        plugins = JSON.parse(pluginsJson || '[]');
    }
    return {
        plugins,
        stableVersion: get('--stable-version'),
        masterSha: get('--master-sha'),
        mode: get('--mode') || 'changed_only',
        pluginFilter: get('--plugin-filter') || '',
        includeMaster: get('--include-master') === 'true',
        isScheduled: get('--is-scheduled') === 'true'
    };
}
function main() {
    const args = parseArgs();
    const resultsPath = path.resolve(__dirname, '..', 'results.json');
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    let plugins = args.plugins;
    if (args.mode === 'single_plugin' && args.pluginFilter) {
        plugins = plugins.filter((p) => p.name === args.pluginFilter);
    }
    const force = args.mode === 'all_plugins' || args.mode === 'single_plugin';
    const runs = [];
    for (const plugin of plugins) {
        markOutdated(results, plugin.name, plugin.version);
        const stableCheck = shouldTest(plugin.name, plugin.version, 'stable', args.stableVersion, results, force);
        if (stableCheck.run) {
            runs.push({
                plugin: plugin.name,
                pluginVersion: plugin.version,
                server: 'stable',
                serverVersion: args.stableVersion,
                reason: stableCheck.reason
            });
        }
        if (args.includeMaster) {
            const masterCheck = shouldTest(plugin.name, plugin.version, 'master', args.masterSha, results, force);
            if (masterCheck.run) {
                runs.push({
                    plugin: plugin.name,
                    pluginVersion: plugin.version,
                    server: 'master',
                    serverVersion: args.masterSha,
                    reason: masterCheck.reason
                });
            }
        }
    }
    if (Object.keys(results).length > 0) {
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');
    }
    // Cap per run — untested plugins are picked up on subsequent runs
    const MAX_MATRIX_JOBS = parseInt(process.env.MAX_MATRIX_JOBS || '50', 10);
    if (runs.length > MAX_MATRIX_JOBS) {
        console.error(`[plan] Capping ${runs.length} runs to ${MAX_MATRIX_JOBS} (remaining will be picked up in next run)`);
        runs.length = MAX_MATRIX_JOBS;
    }
    const output = [
        `runs=${JSON.stringify(runs)}`,
        `has_runs=${runs.length > 0}`
    ].join('\n');
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
    }
    else {
        console.log(`Planned ${runs.length} test runs:`);
        for (const run of runs) {
            console.log(`  ${run.plugin}@${run.pluginVersion} x ${run.server} [${run.reason}]`);
        }
    }
}
main();
