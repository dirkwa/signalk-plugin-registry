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
exports.extractFromIssueBody = extractFromIssueBody;
exports.extractFromComment = extractFromComment;
exports.splitSpecifier = splitSpecifier;
exports.own = own;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const discover_plugins_1 = require("./discover-plugins");
const npm_name_1 = require("./npm-name");
// The Issue Form renders the `npm-name` input under a `### npm package name`
// heading. GitHub writes the answer as the paragraph following that heading.
function extractFromIssueBody(body) {
    const lines = body.split(/\r?\n/);
    const headingIdx = lines.findIndex((l) => /^#{1,6}\s+npm package name\s*$/i.test(l.trim()));
    if (headingIdx === -1)
        return '';
    // First non-empty line after the heading is the answer.
    for (let i = headingIdx + 1; i < lines.length; i++) {
        const v = lines[i].trim();
        if (v)
            return v;
    }
    return '';
}
function extractFromComment(body) {
    // `/rescore some-plugin` — take the first whitespace-delimited token after
    // the command. Backtick-fencing the name is tolerated.
    const m = body.trim().match(/^\/rescore\s+`?([^\s`]+)`?/i);
    return m ? m[1] : '';
}
/**
 * Split `name`, `name@tag` or `@scope/name@version` into its two halves.
 *
 * The last `@` is the separator, and only when it is not the scope marker at
 * position 0 — otherwise `@signalk/foo` would split into `@signalk/foo` and an
 * empty specifier.
 */
function splitSpecifier(raw) {
    const at = raw.lastIndexOf('@');
    if (at <= 0) {
        return { name: raw, specifier: '' };
    }
    return { name: raw.slice(0, at), specifier: raw.slice(at + 1) };
}
/** Own-property read, so a key like `constructor` cannot reach the prototype. */
function own(obj, key) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) {
        return undefined;
    }
    return obj[key];
}
function loadRegistryNames() {
    const registryPath = path.resolve(__dirname, '..', 'registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    return new Set(registry.plugins.map((p) => p.npm));
}
async function evaluate(rawRequest) {
    const fail = (reason) => ({
        valid: false,
        name: '',
        version: '',
        category: '',
        reason
    });
    if (!rawRequest) {
        return fail('no npm package name was provided.');
    }
    const { name: rawName, specifier } = splitSpecifier(rawRequest);
    if (!(0, npm_name_1.isValidNpmName)(rawName)) {
        return fail(`\`${rawName}\` is not a valid npm package name.`);
    }
    const doc = await (0, discover_plugins_1.fetchPackument)(rawName);
    if (!doc) {
        return fail(`\`${rawName}\` was not found on the npm registry.`);
    }
    // An empty specifier means `latest`, which is what a request without an `@`
    // has always meant.
    const wanted = specifier || 'latest';
    // Own properties only, and typed: `doc` is parsed from a network response, so
    // a bare `doc.versions?.[wanted]` reaches the prototype and `@constructor`
    // resolves to `function Object() { [native code] }`. That string would flow
    // into `npm install ${name}@${version}` in test-harness/runner.ts, which is
    // the injection surface npm-name.ts exists to close for the name.
    const tag = own(doc['dist-tags'], wanted);
    // A dist-tag first, then an exact version. Tags win on a collision, matching
    // what `npm install pkg@x` resolves to.
    const version = (typeof tag === 'string' && tag) || (own(doc.versions, wanted) ? wanted : undefined);
    // Belt and braces: whatever npm returned for a tag is not this repo's to
    // trust either, and a version reaches a shell unescaped downstream.
    //
    // The exact-version rule rather than mere shell-safety, so this agrees with
    // the check plan-runs.ts applies at the matrix boundary: a request that gets
    // an acknowledgement here must not then be rejected there. npm enforces
    // semver on publish, so this rejects nothing a real tag resolves to.
    if (version && !(0, npm_name_1.isExactVersion)(version)) {
        return fail(`\`${rawName}\` resolved \`${wanted}\` to an unusable version string.`);
    }
    if (!version) {
        const tags = Object.keys(doc['dist-tags'] ?? {});
        return specifier
            ? fail(`\`${rawName}\` has no version or dist-tag \`${specifier}\` on npm.` +
                (tags.length ? ` Published tags: ${tags.map((t) => `\`${t}\``).join(', ')}.` : ''))
            : fail(`\`${rawName}\` has no published version on npm.`);
    }
    const versionDoc = doc.versions?.[version];
    const keywords = versionDoc?.keywords ?? [];
    const isPlugin = keywords.includes(discover_plugins_1.PLUGIN_KEYWORD) || loadRegistryNames().has(rawName);
    if (!isPlugin) {
        return fail(`\`${rawName}\`@${version} does not carry the \`${discover_plugins_1.PLUGIN_KEYWORD}\` keyword, so the registry does not treat it as a Signal K plugin. ` +
            `Add the keyword to package.json and republish, then try again.`);
    }
    return {
        valid: true,
        name: rawName,
        version,
        category: '',
        reason: ''
    };
}
function emit(result) {
    // newlines in `reason` would corrupt $GITHUB_OUTPUT's key=value lines; the
    // reason is a single human sentence, but collapse defensively.
    const reason = result.reason.replace(/\r?\n/g, ' ').trim();
    const lines = [
        `valid=${result.valid}`,
        `name=${result.name}`,
        `version=${result.version}`,
        `reason=${reason}`
    ];
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
    }
    else {
        console.log(lines.join('\n'));
    }
}
async function main() {
    const eventName = process.env.EVENT_NAME || '';
    const rawName = eventName === 'issue_comment'
        ? extractFromComment(process.env.COMMENT_BODY || '')
        : extractFromIssueBody(process.env.ISSUE_BODY || '');
    emit(await evaluate(rawName));
}
// Guarded so a test can import the parsing helpers without the module
// reaching for the network and writing to $GITHUB_OUTPUT on import.
if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
