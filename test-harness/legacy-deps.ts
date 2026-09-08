import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { isRegistryRange } from "./core-deps";

// Runtime libraries the server provides at a fixed major and bridges for older
// plugin builds only through temporary compatibility shims:
//
// - baconjs: the server moved to 3.x in 2.24.0 and hooks module resolution so
//   a plugin's own 0.7/1.x copy is never loaded (signalk-server#2487). A plugin
//   still declaring baconjs <3 ships a dead dependency and breaks the moment
//   the shim goes away.
// - react: the admin UI is React 19 and bridges Module Federation remotes
//   built against React 16 through an isolated ReactDOM.render subtree
//   (signalk-server#2342, #2452, reminder #2451).
//
// Both are pure metadata/file inspections — no plugin code runs.
export const BACONJS_MIN_MAJOR = 3;
export const REACT_HOST_MAJOR = 19;

// package.json keywords that make the server inject the plugin's
// public/remoteEntry.js into the admin UI (src/interfaces/webapps.ts).
export const EMBEDDED_WEBAPP_KEYWORDS: readonly string[] = [
  "signalk-embeddable-webapp",
  "signalk-plugin-configurator",
  "signalk-node-server-addon",
];

export interface LegacyDep {
  pkg: "baconjs" | "react";
  // The declared range (baconjs) or the shared version registered by the
  // built remote (react).
  found: string;
  required: string;
}

// A baconjs range is legacy when it cannot resolve to any 3.x release. "*",
// ">=1", dist-tags and invalid ranges are not flagged. The lower bound is
// 3.0.0-0 so a 3.x prerelease pin counts as 3.x.
const BACONJS_OK_RANGE = `>=${BACONJS_MIN_MAJOR}.0.0-0`;

export function findLegacyBaconjs(
  declared: Array<{ pkg: string; range: string }>,
): LegacyDep | null {
  for (const { pkg, range } of declared) {
    if (pkg !== "baconjs") continue;
    if (!isRegistryRange(range)) continue;
    if (semver.validRange(range) === null) continue;
    if (!semver.intersects(range, BACONJS_OK_RANGE)) {
      return {
        pkg: "baconjs",
        found: range,
        required: `>=${BACONJS_MIN_MAJOR}`,
      };
    }
  }
  return null;
}

// Shared-React registrations emitted by the two Module Federation build
// tools Signal K plugins use. Consume-only remotes (import: false, host React)
// register no version and are not legacy — they run on the host's React, the
// same distinction the admin UI's containerUsesLegacyReact() draws.
//   webpack:  l("react","16.14.0",factory)  or the curried form newer webpack
//             emits, ((n,v)=>{...})("react","16.14.0")  — so no trailing comma
//             can be required. This is the admin UI's regex plus optional
//             whitespace, so an unminified (development) build matches too.
//   vite MF:  name:`react`,version:`19.2.8`  (or the same with double quotes)
const WEBPACK_SHARED_REACT = /\(\s*"react"\s*,\s*"(\d+)\.\d+\.\d+"/g;
const VITE_SHARED_REACT =
  /name\s*:\s*[`"']react[`"']\s*,\s*version\s*:\s*[`"'](\d+)\.\d+\.\d+[`"']/g;

export function findSharedReactMajors(source: string): number[] {
  const majors = new Set<number>();
  for (const pattern of [WEBPACK_SHARED_REACT, VITE_SHARED_REACT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      majors.add(parseInt(match[1], 10));
    }
  }
  return [...majors];
}

export function findLegacyReact(sources: Iterable<string>): LegacyDep | null {
  for (const source of sources) {
    for (const major of findSharedReactMajors(source)) {
      if (major < REACT_HOST_MAJOR) {
        return {
          pkg: "react",
          found: String(major),
          required: `>=${REACT_HOST_MAJOR}`,
        };
      }
    }
  }
  return null;
}

// The server serves an embedded webapp from <plugin>/public/ when it exists,
// otherwise from the package root (src/interfaces/webapps.ts), and injects
// <root>/remoteEntry.js into the admin UI (src/serverroutes.ts).
const REMOTE_ENTRY = "remoteEntry.js";

function webappRoot(pluginDir: string): string {
  const pub = path.join(pluginDir, "public");
  try {
    if (fs.lstatSync(pub).isDirectory()) return pub;
  } catch {
    // no public/ — fall through
  }
  return pluginDir;
}

// Only what the admin UI can actually execute is inspected: remoteEntry.js
// and the relative .js paths reachable from it. webpack registers shared
// versions in remoteEntry.js itself; a vite MF remote registers them in a
// chunk (the localSharedImportMap virtual module) that remoteEntry.js reaches
// through one or more imports, depending on the @module-federation/vite
// version. Files under public/ that nothing references — stale builds,
// unrelated entries — are not consulted, exactly as the browser never loads
// them. The tarball is untrusted, so the traversal is bounded: regular files
// only (symlinks are never followed), inside the webapp root, at most
// MAX_BUNDLE_FILES files, MAX_BUNDLE_BYTES per file and MAX_BUNDLE_TOTAL_BYTES
// overall; anything past a limit is skipped (indeterminate).
export const MAX_BUNDLE_FILES = 500;
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MAX_BUNDLE_TOTAL_BYTES = 64 * 1024 * 1024;

const RELATIVE_JS_REF = /["'`](\.{1,2}\/[^"'`\s]+\.m?js)["'`]/g;

function* readRemoteBundles(root: string): Generator<string> {
  let totalBytes = 0;
  const readBounded = (file: string): string | null => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) return null;
    if ((totalBytes += stat.size) > MAX_BUNDLE_TOTAL_BYTES) return null;
    return fs.readFileSync(file, "utf-8");
  };

  const queue = [path.join(root, REMOTE_ENTRY)];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    if (visited.size >= MAX_BUNDLE_FILES) return;
    visited.add(file);
    const source = readBounded(file);
    if (source === null) continue;
    yield source;
    // References resolve relative to the importing file, like the browser.
    for (const match of source.matchAll(RELATIVE_JS_REF)) {
      const full = path.resolve(path.dirname(file), match[1]);
      if (full.startsWith(root + path.sep)) queue.push(full);
    }
  }
}

// Reads the installed plugin's package.json and, for embedded webapps, its
// remote entry. Any read failure yields [] (indeterminate, no penalty).
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function checkLegacyDeps(pluginDir: string): LegacyDep[] {
  const found: LegacyDep[] = [];
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8"),
    );
    const pkg = isRecord(parsed) ? parsed : {};

    const declared: Array<{ pkg: string; range: string }> = [];
    for (const field of ["dependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (!isRecord(deps)) continue;
      for (const [name, range] of Object.entries(deps)) {
        if (typeof range === "string") declared.push({ pkg: name, range });
      }
    }
    const bacon = findLegacyBaconjs(declared);
    if (bacon) found.push(bacon);

    const keywords = pkg.keywords;
    const embedded =
      Array.isArray(keywords) &&
      keywords.some(
        (k) => typeof k === "string" && EMBEDDED_WEBAPP_KEYWORDS.includes(k),
      );
    if (embedded) {
      const react = findLegacyReact(readRemoteBundles(webappRoot(pluginDir)));
      if (react) found.push(react);
    }
  } catch {
    // unreadable package.json or bundle — indeterminate
  }
  return found;
}
