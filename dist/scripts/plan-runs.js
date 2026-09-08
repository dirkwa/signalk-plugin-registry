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
const npm_name_1 = require("./npm-name");
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
    const REQUIRED_FIELDS = [
        'has_changelog',
        'has_screenshots',
        'held_back_core_deps'
    ];
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
        pluginVersion: get('--plugin-version') || '',
        includeMaster: get('--include-master') === 'true',
        isScheduled: get('--is-scheduled') === 'true'
    };
}
function main() {
    const args = parseArgs();
    // resolve-server.ts emits an empty master_sha when the GitHub lookup fails,
    // which is harmless unless this run actually plans master slots. Planning
    // them against an empty serverVersion would poison the slotKey and its
    // `tested` cache entry, so fail loudly instead.
    if (args.includeMaster && !args.masterSha) {
        console.error('include_master was requested but master_sha is empty — the ' +
            'signalk-server master SHA lookup failed upstream in resolve-server.ts');
        process.exit(1);
    }
    const resultsPath = path.resolve(__dirname, '..', 'results.json');
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    let plugins = args.plugins;
    if (args.mode === 'single_plugin' && args.pluginFilter) {
        plugins = plugins.filter((p) => p.name === args.pluginFilter);
    }
    // Discovery only ever resolves dist-tags.latest, so scoring a pre-release
    // means testing a version other than the one it found.
    //
    // Kept beside the discovered version rather than replacing it: `markOutdated`
    // takes the *latest* version, not the one under test, and overwriting it
    // would stamp `outdated: true, superseded_by: <pre-release>` on the real
    // latest — telling the published page that the current stable release was
    // superseded by a beta.
    //
    // Validated here as well as in rescore.yml, exactly as resolve-single-plugin
    // does for the name: `plugin_version` is also a workflow_dispatch input that
    // anyone holding actions: write can type by hand, and it reaches
    // `npm install <name>@<version>` unescaped in test-harness/runner.ts.
    //
    // An *exact* version, not merely a shell-safe string: this value becomes the
    // version key in results.json, and a dist-tag like `beta` would write a slot
    // under that name beside the real versions — permanently, since slots are
    // never deleted. rescore.yml resolves tags to a concrete version before
    // dispatching, so a tag arriving here is a hand-typed dispatch, not a
    // re-score request.
    let requestedVersion = '';
    if (args.mode === 'single_plugin' && args.pluginFilter && args.pluginVersion) {
        if (!(0, npm_name_1.isExactVersion)(args.pluginVersion)) {
            console.error(`[plan] Not an exact npm version: ${args.pluginVersion}`);
            process.exit(1);
        }
        requestedVersion = args.pluginVersion;
    }
    const force = args.mode === 'all_plugins' || args.mode === 'single_plugin';
    const runs = [];
    for (const plugin of plugins) {
        // Always the discovered latest, never the requested pre-release.
        markOutdated(results, plugin.name, plugin.version);
        const testVersion = requestedVersion || plugin.version;
        const stableCheck = shouldTest(plugin.name, testVersion, 'stable', args.stableVersion, results, force);
        if (stableCheck.run) {
            runs.push({
                plugin: plugin.name,
                pluginVersion: testVersion,
                server: 'stable',
                serverVersion: args.stableVersion,
                reason: stableCheck.reason
            });
        }
        if (args.includeMaster) {
            const masterCheck = shouldTest(plugin.name, testVersion, 'master', args.masterSha, results, force);
            if (masterCheck.run) {
                runs.push({
                    plugin: plugin.name,
                    pluginVersion: testVersion,
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
    // Order runs by re-test reason before applying the cap. Staleness (>7d) is a
    // renewable source of work — in steady state ~1/7 of every already-tested
    // plugin requalifies each night, which on its own exceeds MAX_MATRIX_JOBS.
    // Because runs are built in discovery (npm popularity) order and the cap
    // keeps the front of the list, that stale churn permanently starves the tail:
    // a newly published, low-download plugin (which sorts last on npm) never
    // reaches a test slot, so it never lands in results.json or on the site.
    // Stable-sort the higher-signal reasons ahead of `stale` so new and changed
    // plugins are always tested first; the cap then only ever defers stale
    // refreshes, which genuinely are picked up on a later run.
    const REASON_PRIORITY = {
        manual: 0,
        plugin_version_change: 1,
        server_version_change: 2,
        schema_change: 3,
        stale: 4,
        nightly: 5
    };
    // Within a tier, retest the longest-untested slot first. Stale demand
    // (~460 plugins on a 7-day window) exceeds the nightly cap in steady state,
    // so keeping discovery (popularity) order here would refresh popular plugins
    // every cycle while the unpopular tail ages without bound (p90 slot age was
    // 59 days when this landed). Oldest-first turns deferred stale work into a
    // round-robin bounded by capacity. Runs with no prior slot sort as epoch 0
    // and the stable sort keeps them in discovery order.
    const lastTested = (run) => {
        const slot = results[run.plugin]?.[run.pluginVersion]?.[`server@${run.server}`];
        return slot && typeof slot === 'object' ? new Date(slot.tested).getTime() : 0;
    };
    runs.sort((a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason] ||
        lastTested(a) - lastTested(b));
    // Cap per run. With runs ordered by reason above, the cap only ever defers
    // `stale` refreshes — never a new or changed plugin — so deferred work
    // really is picked up on a subsequent run.
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
