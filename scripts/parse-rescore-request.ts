import * as fs from 'fs'
import * as path from 'path'
import { fetchPackument, PLUGIN_KEYWORD } from './discover-plugins'
import { isExactVersion, isValidNpmName } from './npm-name'

// The trust boundary for the on-demand re-score path. Reads the requested npm
// package name from the issue body (Issue Form) or a `/rescore <name>` comment
// — both attacker-controlled — and decides whether it is safe and worth
// dispatching a scan for. It emits machine-readable results to $GITHUB_OUTPUT;
// rescore.yml acts on them. This script holds no token and runs no plugin code.
//
// Two gates, in order:
//   1. Syntactic — the name must match the npm grammar. This neutralises the
//      unescaped-shell-interpolation surface in test-harness/runner.ts at the
//      source: no shell metacharacter survives.
//   2. Semantic — the package must exist on npm AND be a real Signal K plugin
//      (carries the signalk-node-server-plugin keyword, or is in the curated
//      registry.json). This stops the trigger being abused as an arbitrary
//      `npm install <anything>` / free-compute primitive.
//
// A request may name a dist-tag or an exact version — `my-plugin@beta`,
// `my-plugin@2.0.0-rc.1` — so an author can score a pre-release before
// promoting it to `latest`. The specifier is resolved here against the
// packument and only ever leaves as a concrete version already known to exist,
// so nothing downstream installs a string the requester chose.

interface ParseResult {
  valid: boolean
  name: string
  version: string
  category: string
  reason: string
}

// The Issue Form renders the `npm-name` input under a `### npm package name`
// heading. GitHub writes the answer as the paragraph following that heading.
export function extractFromIssueBody(body: string): string {
  const lines = body.split(/\r?\n/)
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s+npm package name\s*$/i.test(l.trim()))
  if (headingIdx === -1) return ''
  // First non-empty line after the heading is the answer.
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const v = lines[i].trim()
    if (v) return v
  }
  return ''
}

export function extractFromComment(body: string): string {
  // `/rescore some-plugin` — take the first whitespace-delimited token after
  // the command. Backtick-fencing the name is tolerated.
  const m = body.trim().match(/^\/rescore\s+`?([^\s`]+)`?/i)
  return m ? m[1] : ''
}

/**
 * Split `name`, `name@tag` or `@scope/name@version` into its two halves.
 *
 * The last `@` is the separator, and only when it is not the scope marker at
 * position 0 — otherwise `@signalk/foo` would split into `@signalk/foo` and an
 * empty specifier.
 */
export function splitSpecifier(raw: string): { name: string; specifier: string } {
  const at = raw.lastIndexOf('@')
  if (at <= 0) {
    return { name: raw, specifier: '' }
  }
  return { name: raw.slice(0, at), specifier: raw.slice(at + 1) }
}

/** Own-property read, so a key like `constructor` cannot reach the prototype. */
export function own<T>(obj: Record<string, T> | undefined, key: string): T | undefined {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined
  }
  return obj[key]
}

function loadRegistryNames(): Set<string> {
  const registryPath = path.resolve(__dirname, '..', 'registry.json')
  const registry: { plugins: Array<{ npm: string }> } = JSON.parse(
    fs.readFileSync(registryPath, 'utf-8')
  )
  return new Set(registry.plugins.map((p) => p.npm))
}

async function evaluate(rawRequest: string): Promise<ParseResult> {
  const fail = (reason: string): ParseResult => ({
    valid: false,
    name: '',
    version: '',
    category: '',
    reason
  })

  if (!rawRequest) {
    return fail('no npm package name was provided.')
  }

  const { name: rawName, specifier } = splitSpecifier(rawRequest)

  if (!isValidNpmName(rawName)) {
    return fail(`\`${rawName}\` is not a valid npm package name.`)
  }

  const doc = await fetchPackument(rawName)
  if (!doc) {
    return fail(`\`${rawName}\` was not found on the npm registry.`)
  }

  // An empty specifier means `latest`, which is what a request without an `@`
  // has always meant.
  const wanted = specifier || 'latest'
  // Own properties only, and typed: `doc` is parsed from a network response, so
  // a bare `doc.versions?.[wanted]` reaches the prototype and `@constructor`
  // resolves to `function Object() { [native code] }`. That string would flow
  // into `npm install ${name}@${version}` in test-harness/runner.ts, which is
  // the injection surface npm-name.ts exists to close for the name.
  const tag = own(doc['dist-tags'], wanted)
  // A dist-tag first, then an exact version. Tags win on a collision, matching
  // what `npm install pkg@x` resolves to.
  const version =
    (typeof tag === 'string' && tag) || (own(doc.versions, wanted) ? wanted : undefined)
  // Belt and braces: whatever npm returned for a tag is not this repo's to
  // trust either, and a version reaches a shell unescaped downstream.
  //
  // The exact-version rule rather than mere shell-safety, so this agrees with
  // the check plan-runs.ts applies at the matrix boundary: a request that gets
  // an acknowledgement here must not then be rejected there. npm enforces
  // semver on publish, so this rejects nothing a real tag resolves to.
  if (version && !isExactVersion(version)) {
    return fail(`\`${rawName}\` resolved \`${wanted}\` to an unusable version string.`)
  }
  if (!version) {
    const tags = Object.keys(doc['dist-tags'] ?? {})
    return specifier
      ? fail(
          `\`${rawName}\` has no version or dist-tag \`${specifier}\` on npm.` +
            (tags.length ? ` Published tags: ${tags.map((t) => `\`${t}\``).join(', ')}.` : '')
        )
      : fail(`\`${rawName}\` has no published version on npm.`)
  }

  const versionDoc = doc.versions?.[version]
  const keywords = versionDoc?.keywords ?? []
  const isPlugin = keywords.includes(PLUGIN_KEYWORD) || loadRegistryNames().has(rawName)
  if (!isPlugin) {
    return fail(
      `\`${rawName}\`@${version} does not carry the \`${PLUGIN_KEYWORD}\` keyword, so the registry does not treat it as a Signal K plugin. ` +
        `Add the keyword to package.json and republish, then try again.`
    )
  }

  return {
    valid: true,
    name: rawName,
    version,
    category: '',
    reason: ''
  }
}

function emit(result: ParseResult) {
  // newlines in `reason` would corrupt $GITHUB_OUTPUT's key=value lines; the
  // reason is a single human sentence, but collapse defensively.
  const reason = result.reason.replace(/\r?\n/g, ' ').trim()
  const lines = [
    `valid=${result.valid}`,
    `name=${result.name}`,
    `version=${result.version}`,
    `reason=${reason}`
  ]
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')
  } else {
    console.log(lines.join('\n'))
  }
}

async function main() {
  const eventName = process.env.EVENT_NAME || ''
  const rawName =
    eventName === 'issue_comment'
      ? extractFromComment(process.env.COMMENT_BODY || '')
      : extractFromIssueBody(process.env.ISSUE_BODY || '')

  emit(await evaluate(rawName))
}

// Guarded so a test can import the parsing helpers without the module
// reaching for the network and writing to $GITHUB_OUTPUT on import.
if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
