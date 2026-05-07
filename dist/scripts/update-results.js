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
function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : '';
    };
    return {
        plugin: get('--plugin'),
        pluginVersion: get('--plugin-version'),
        serverSlot: get('--server-slot'),
        serverVersion: get('--server-version'),
        result: get('--result'),
        resultFile: get('--result-file'),
        reason: get('--reason')
    };
}
function main() {
    const args = parseArgs();
    const resultsPath = path.resolve(__dirname, '..', 'results.json');
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    if (!results[args.plugin]) {
        results[args.plugin] = {};
    }
    if (!results[args.plugin][args.pluginVersion]) {
        results[args.plugin][args.pluginVersion] = {};
    }
    let resultData;
    try {
        const raw = args.resultFile
            ? fs.readFileSync(args.resultFile, 'utf-8')
            : args.result;
        resultData = JSON.parse(raw);
    }
    catch {
        console.error('Failed to parse result JSON');
        process.exit(1);
    }
    const slotKey = `server@${args.serverSlot}`;
    const slotResult = {
        tested: new Date().toISOString(),
        triggered_by: args.reason,
        node_version: process.version.replace('v', '').split('.')[0],
        ...(args.serverSlot === 'stable'
            ? { server_version: args.serverVersion }
            : { server_sha: args.serverVersion }),
        installs: resultData.installs,
        install_error: resultData.installError,
        loads: resultData.detection && resultData.detection.loads,
        load_error: resultData.detection && resultData.detection.loadError,
        activation_error: resultData.detection && resultData.detection.activationError,
        activates: resultData.detection && resultData.detection.activates,
        activates_without_config: resultData.detection && resultData.detection.activatesWithoutConfig,
        activation_without_config_error: resultData.detection && resultData.detection.activationWithoutConfigError,
        detected_providers: resultData.detection && resultData.detection.providers,
        unstubbed_accesses: resultData.detection && resultData.detection.unstubbedAccesses,
        has_schema: resultData.detection && resultData.detection.hasSchema,
        has_own_tests: resultData.hasOwnTests,
        own_tests_pass: resultData.ownTestsPass,
        tests_runnable: resultData.testsRunnable,
        has_install_scripts: resultData.hasInstallScripts,
        has_changelog: resultData.hasChangelog,
        has_screenshots: resultData.hasScreenshots,
        audit_critical: resultData.auditCritical,
        audit_high: resultData.auditHigh,
        audit_moderate: resultData.auditModerate,
        composite: resultData.composite,
        badges: resultData.badges,
        test_status: resultData.testStatus
    };
    // Remove undefined values
    for (const key of Object.keys(slotResult)) {
        if (slotResult[key] === undefined)
            delete slotResult[key];
    }
    const existing = results[args.plugin][args.pluginVersion][slotKey];
    const oldScore = existing?.composite ?? -1;
    const newScore = slotResult.composite ?? 0;
    results[args.plugin][args.pluginVersion][slotKey] = slotResult;
    console.log(`Updated ${args.plugin}@${args.pluginVersion} [${slotKey}] score=${newScore}` +
        (oldScore >= 0 ? ` (was ${oldScore})` : ''));
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');
    // Also write a single-slot envelope so the parallel merge step can
    // apply only this run's slot instead of merging the entire base
    // results.json from every artifact (which causes one job to clobber
    // another's update).
    const envelope = {
        plugin: args.plugin,
        pluginVersion: args.pluginVersion,
        slotKey,
        slotResult
    };
    const envelopePath = path.resolve(__dirname, '..', 'slot-update.json');
    fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2) + '\n');
}
main();
