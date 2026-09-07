// The single source of truth for "is this a syntactically valid npm package
// name". This is a load-bearing security control: the plugin name flows
// unescaped into a shell command in test-harness/runner.ts
// (`npm install ${pluginName}@...`). On the on-demand re-score path the name
// originates from an attacker-controlled GitHub issue, so it must be fenced to
// the npm grammar before it can reach the matrix. Both the request parser and
// the single-plugin resolver validate through here.

// npm package grammar: optional `@scope/`, then the package name. Each segment
// starts with a URL-safe char and may contain `-`, `.`, `_`, `~`. Total length
// (including any scope) is capped at 214 by npm.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const MAX_NPM_NAME_LENGTH = 214

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
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?$/

export function isExactVersion(version: string): boolean {
  return typeof version === 'string' && version.length <= 128 && EXACT_VERSION_RE.test(version)
}

export function isValidNpmName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    // A leading dash matches the grammar but reads as an option flag when the
    // name reaches `npm install <name>` (e.g. `-g`). Exclude it at the boundary.
    !name.startsWith('-') &&
    name.length <= MAX_NPM_NAME_LENGTH &&
    NPM_NAME_RE.test(name)
  )
}
