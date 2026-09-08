import * as semver from "semver";

// Core Signal K packages whose user-install copies (in ~/.signalk) are held
// back when a plugin declares a range that excludes the latest release.
// @signalk/server-admin-ui is deliberately absent: a plugin depending on it
// is anomalous and cannot hold back the server's bundled copy.
export const CORE_PACKAGES: readonly string[] = [
  "@signalk/server-api",
  "@canboat/canboatjs",
  "@canboat/ts-pgns",
  "@signalk/n2k-signalk",
  "@signalk/nmea0183-signalk",
  "@signalk/streams",
];

export interface HeldBackCoreDep {
  pkg: string;
  declared: string;
  latest: string;
}

// git/file/link/workspace/URL specs (and GitHub owner/repo shorthand) are not
// registry ranges — they can't be evaluated against a published latest.
const NON_REGISTRY_SPEC = /^(git\+|git:|github:|file:|link:|workspace:|https?:)/;

export function isRegistryRange(range: string): boolean {
  return !NON_REGISTRY_SPEC.test(range) && !range.includes("/");
}

// A range holds a package back when it cannot resolve to the latest published
// version even though it targets the same major. Old-major ranges are not
// flagged: a plugin may legitimately not support a new major yet.
function isHeldBack(range: string, latest: string): boolean {
  if (!isRegistryRange(range)) return false;
  if (semver.validRange(range) === null) return false;
  const min = semver.minVersion(range);
  if (!min) return false;
  return !semver.satisfies(latest, range) && min.major === semver.major(latest);
}

// declared: the plugin's dependencies + peerDependencies entries, already
// filtered to CORE_PACKAGES. latestVersions: pkg -> dist-tags.latest; a
// package missing from the map had a failed lookup and is never flagged.
export function findHeldBackCoreDeps(
  declared: Array<{ pkg: string; range: string }>,
  latestVersions: Record<string, string>,
): HeldBackCoreDep[] {
  const held = new Map<string, HeldBackCoreDep>();
  for (const { pkg, range } of declared) {
    if (held.has(pkg)) continue;
    const latest = latestVersions[pkg];
    if (!latest || !semver.valid(latest)) continue;
    if (isHeldBack(range, latest)) {
      held.set(pkg, { pkg, declared: range, latest });
    }
  }
  return [...held.values()];
}

const latestCache = new Map<string, string>();

export async function fetchLatestVersions(
  pkgs: string[],
): Promise<Record<string, string>> {
  const latest: Record<string, string> = {};
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

async function fetchLatest(pkg: string): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          "dist-tags"?: { latest?: string };
        };
        return data["dist-tags"]?.latest ?? null;
      }
      // 5xx, 429, … — couldn't read the registry; fall through to retry.
    } catch {
      // network error or timeout — transient; fall through to retry.
    }
  }
  console.error(
    `[runner] core-dep latest lookup for ${pkg} failed after retries; not penalizing`,
  );
  return null;
}
