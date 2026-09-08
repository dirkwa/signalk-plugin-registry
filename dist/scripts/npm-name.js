"use strict";
// The single source of truth for "is this a syntactically valid npm package
// name". This is a load-bearing security control: the plugin name flows
// unescaped into a shell command in test-harness/runner.ts
// (`npm install ${pluginName}@...`). On the on-demand re-score path the name
// originates from an attacker-controlled GitHub issue, so it must be fenced to
// the npm grammar before it can reach the matrix. Both the request parser and
// the single-plugin resolver validate through here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrerelease = isPrerelease;
exports.isExactVersion = isExactVersion;
exports.isValidNpmName = isValidNpmName;
// npm package grammar: optional `@scope/`, then the package name. Each segment
// starts with a URL-safe char and may contain `-`, `.`, `_`, `~`. Total length
// (including any scope) is capped at 214 by npm.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const MAX_NPM_NAME_LENGTH = 214;
// The same control for a version. A resolved version is interpolated unescaped
// into `npm install <name>@<version>` in test-harness/runner.ts, so it needs the
// same fencing the name gets. On the re-score path it originates from an issue;
// on the dispatch path it is typed into a workflow_dispatch input.
//
// Exact rather than merely shell-safe, because the value also becomes the
// version key in results.json. A dist-tag like `beta` is alphanumeric and would
// pass a plain shell-safety check, but a run keyed on `beta` writes a slot under
// that name beside the real versions — permanently, since slots are never
// deleted. So: `major.minor.patch`, plus npm's optional pre-release and build
// metadata, and nothing else.
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?$/;
/**
 * Whether a version is a pre-release — anything carrying a `-suffix`.
 *
 * SemVer says `1.0.0-beta.1` precedes `1.0.0`, but a plain string sort puts it
 * after: `'3.0.0-beta.0'.localeCompare('2.1.0')` is positive, so a beta
 * outranks every earlier stable release. The published page picks one version
 * to show per plugin, and it must be the one npm hands a user who installs the
 * plugin — showing a pre-release's score against a release nobody gets is worse
 * than showing nothing.
 */
function isPrerelease(version) {
    if (typeof version !== 'string') {
        return false;
    }
    // SemVer puts build metadata after `+` and the pre-release tag before it, so
    // only the part before `+` may carry one. `1.2.3+build-meta` is a stable
    // release whose metadata happens to contain a hyphen.
    const [beforeBuild] = version.split('+');
    return beforeBuild.includes('-');
}
function isExactVersion(version) {
    return typeof version === 'string' && version.length <= 128 && EXACT_VERSION_RE.test(version);
}
function isValidNpmName(name) {
    return (typeof name === 'string' &&
        name.length > 0 &&
        // A leading dash matches the grammar but reads as an option flag when the
        // name reaches `npm install <name>` (e.g. `-g`). Exclude it at the boundary.
        !name.startsWith('-') &&
        name.length <= MAX_NPM_NAME_LENGTH &&
        NPM_NAME_RE.test(name));
}
