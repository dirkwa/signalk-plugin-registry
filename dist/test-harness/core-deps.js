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
exports.CORE_PACKAGES = void 0;
exports.findHeldBackCoreDeps = findHeldBackCoreDeps;
exports.fetchLatestVersions = fetchLatestVersions;
const semver = __importStar(require("semver"));
// Core Signal K packages whose user-install copies (in ~/.signalk) are held
// back when a plugin declares a range that excludes the latest release.
// @signalk/server-admin-ui is deliberately absent: a plugin depending on it
// is anomalous and cannot hold back the server's bundled copy.
exports.CORE_PACKAGES = [
    "@signalk/server-api",
    "@canboat/canboatjs",
    "@canboat/ts-pgns",
    "@signalk/n2k-signalk",
    "@signalk/nmea0183-signalk",
    "@signalk/streams",
];
// git/file/link/workspace/URL specs (and GitHub owner/repo shorthand) are not
// registry ranges — they can't be evaluated against a published latest.
const NON_REGISTRY_SPEC = /^(git\+|git:|github:|file:|link:|workspace:|https?:)/;
function isRegistryRange(range) {
    return !NON_REGISTRY_SPEC.test(range) && !range.includes("/");
}
// A range holds a package back when it cannot resolve to the latest published
// version even though it targets the same major. Old-major ranges are not
// flagged: a plugin may legitimately not support a new major yet.
function isHeldBack(range, latest) {
    if (!isRegistryRange(range))
        return false;
    if (semver.validRange(range) === null)
        return false;
    const min = semver.minVersion(range);
    if (!min)
        return false;
    return !semver.satisfies(latest, range) && min.major === semver.major(latest);
}
// declared: the plugin's dependencies + peerDependencies entries, already
// filtered to CORE_PACKAGES. latestVersions: pkg -> dist-tags.latest; a
// package missing from the map had a failed lookup and is never flagged.
function findHeldBackCoreDeps(declared, latestVersions) {
    const held = new Map();
    for (const { pkg, range } of declared) {
        if (held.has(pkg))
            continue;
        const latest = latestVersions[pkg];
        if (!latest || !semver.valid(latest))
            continue;
        if (isHeldBack(range, latest)) {
            held.set(pkg, { pkg, declared: range, latest });
        }
    }
    return [...held.values()];
}
const latestCache = new Map();
async function fetchLatestVersions(pkgs) {
    const latest = {};
    for (const pkg of pkgs) {
        const cached = latestCache.get(pkg);
        if (cached) {
            latest[pkg] = cached;
            continue;
        }
        const version = await fetchLatest(pkg);
        if (version) {
            latestCache.set(pkg, version);
            latest[pkg] = version;
        }
    }
    return latest;
}
async function fetchLatest(pkg) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(15_000),
                headers: { Accept: "application/vnd.npm.install-v1+json" },
            });
            if (res.ok) {
                const data = (await res.json());
                return data["dist-tags"]?.latest ?? null;
            }
            // 5xx, 429, … — couldn't read the registry; fall through to retry.
        }
        catch {
            // network error or timeout — transient; fall through to retry.
        }
    }
    console.error(`[runner] core-dep latest lookup for ${pkg} failed after retries; not penalizing`);
    return null;
}
