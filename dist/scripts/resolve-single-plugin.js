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
exports.versionRejection = versionRejection;
const fs = __importStar(require("fs"));
const discover_plugins_1 = require("./discover-plugins");
const npm_name_1 = require("./npm-name");
// Resolves one plugin straight from the per-package npm endpoint and writes a
// one-element plugins.json for plan-runs.ts. This is what the single_plugin
// path uses instead of discover-plugins.ts: the /-/v1/search index that
// discovery relies on lags publishes by up to an hour, so a freshly-published
// plugin is absent from the discovered set and single_plugin silently produces
// zero runs. The per-package endpoint has no such lag, so injecting the one
// requested plugin guarantees it gets probed even seconds after publish.
/**
 * Whether an explicitly requested version may be tested.
 *
 * Two gates, both needed. `isExactVersion` says the string is shaped like a
 * version — a dist-tag such as `beta` is shell-safe but would become a
 * results.json key of its own. Published-ness says npm actually has it: a
 * well-formed but unpublished `99.99.99` fails to install and still leaves a
 * scored slot behind, and slots are never deleted.
 *
 * The published check is an own-property read because `versions` is parsed
 * from a network response, so a plain lookup would accept `constructor`.
 */
function versionRejection(name, version, versions) {
    if (!(0, npm_name_1.isExactVersion)(version)) {
        return `Not an exact npm version: ${version}`;
    }
    if (!Object.prototype.hasOwnProperty.call(versions ?? {}, version)) {
        return `${name}@${version} is not published on npm`;
    }
    return undefined;
}
async function main() {
    const args = process.argv.slice(2);
    const get = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : '';
    };
    const name = get('--name');
    const out = get('--out');
    const version = get('--version');
    if (!name || !out) {
        console.error('Usage: ts-node resolve-single-plugin.ts --name <npm-name> --out <file> [--version <exact-version>]');
        process.exit(1);
    }
    // Defence in depth: rescore.yml already validated the name, but this script
    // is also reachable from a maintainer workflow_dispatch where the name is
    // typed by hand. Never feed an unvalidated name into a network fetch / the
    // matrix.
    if (!(0, npm_name_1.isValidNpmName)(name)) {
        console.error(`[resolve-single] Invalid npm package name: ${name}`);
        process.exit(1);
    }
    const doc = await (0, discover_plugins_1.fetchPackument)(name);
    if (!doc) {
        console.error(`[resolve-single] Package ${name} not found on npm`);
        process.exit(1);
    }
    const info = (0, discover_plugins_1.packumentToPluginInfo)(name, doc);
    if (!info) {
        console.error(`[resolve-single] Package ${name} has no published version`);
        process.exit(1);
    }
    // Deliberately not written into `info.version`: that field is the discovered
    // latest, and plan-runs.ts feeds it to markOutdated. Putting a pre-release
    // there would stamp `superseded_by: <beta>` onto the real latest in
    // results.json. plan-runs.ts takes the version to test as its own argument;
    // this check exists so an unusable one never gets that far.
    if (version) {
        const rejection = versionRejection(name, version, doc.versions);
        if (rejection) {
            console.error(`[resolve-single] ${rejection}`);
            process.exit(1);
        }
    }
    fs.writeFileSync(out, JSON.stringify([info], null, 2) + '\n');
    console.error(`[resolve-single] Wrote ${name}@${info.version} to ${out}`);
}
// Guarded so a test can import the pure helpers without the module reaching
// for the network on import.
if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
