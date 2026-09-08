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
exports.parseDeclaredCiCommands = parseDeclaredCiCommands;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// The reusable workflow a caller references via
//   uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@<ref>
// Case-insensitive; the "@<ref>" suffix is ignored.
const REUSABLE_PLUGIN_CI = "signalk/signalk-server/.github/workflows/plugin-ci.yml";
// A quoted or bare YAML scalar value. Handles 'single', "double", and bare.
function parseScalar(raw) {
    const v = raw.trim();
    if ((v.startsWith("'") && v.endsWith("'") && v.length >= 2) ||
        (v.startsWith('"') && v.endsWith('"') && v.length >= 2)) {
        return v.slice(1, -1);
    }
    // Strip a trailing line comment on a bare scalar (quoted values keep '#').
    const hash = v.indexOf(" #");
    return (hash >= 0 ? v.slice(0, hash) : v).trim();
}
// A declared command is interpolated into a shell, and plugin-ci's
// build-command / test-command exist to invoke an npm script — so accept only
// an `npm run <script>` (or `run-script`) invocation. The character allow-list
// (word chars, spaces, and `.-:/=@`) rejects shell metacharacters, quotes,
// globs, and a YAML flow sequence like `[npm, run, build]` (which parses to
// that literal string); requiring the `npm run` shape additionally rejects
// arbitrary programs (`curl …`) and `npm install`, whose lifecycle scripts
// would sidestep the `--ignore-scripts` install boundary. Anything rejected
// falls back to the heuristic.
function isPlausibleCommand(value) {
    if (!/^[\w .\-:/=@]+$/.test(value))
        return false;
    const parts = value.split(/\s+/);
    return (parts.length >= 3 &&
        parts[0] === "npm" &&
        (parts[1] === "run" || parts[1] === "run-script"));
}
// Parse the `build-command` / `test-command` a plugin declares to the reusable
// Signal K plugin-ci workflow, reading its caller workflow file directly from a
// cloned source tree. Returns {} when the plugin doesn't call the reusable
// workflow or declares neither command.
//
// This is a deliberately small, structural parser rather than a full YAML
// library: the caller workflows we read are machine-shaped and the two inputs
// we want (`with.build-command`, `with.test-command`) are simple scalars. It
// scans .github/workflows/*.yml for a job block whose `uses:` references the
// reusable plugin-ci path, then reads the `build-command` / `test-command`
// keys under that job's `with:` mapping.
function parseDeclaredCiCommands(sourceDir) {
    const workflowsDir = path.join(sourceDir, ".github", "workflows");
    let files;
    try {
        files = fs
            .readdirSync(workflowsDir)
            .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    }
    catch {
        return {};
    }
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(path.join(workflowsDir, file), "utf-8");
        }
        catch {
            continue;
        }
        const declared = commandsFromWorkflow(content);
        if (declared.build || declared.test)
            return declared;
    }
    return {};
}
// Scan one workflow file's text for a job that `uses:` the reusable plugin-ci
// workflow, and read the build-command / test-command from that job's `with:`.
function commandsFromWorkflow(content) {
    const lines = content.split(/\r?\n/);
    let usesIdx = -1;
    let usesIndent = -1;
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)uses:\s*(.+?)\s*$/.exec(lines[i]);
        if (!m)
            continue;
        const target = parseScalar(m[2]).toLowerCase();
        const at = target.indexOf("@"); // drop the "@<ref>" suffix
        const withoutRef = at >= 0 ? target.slice(0, at) : target;
        if (withoutRef === REUSABLE_PLUGIN_CI) {
            usesIdx = i;
            usesIndent = m[1].length;
            break;
        }
    }
    if (usesIdx === -1)
        return {};
    // `uses:` and its sibling `with:` share one indentation and either may come
    // first (YAML mapping order isn't semantic), so bound the whole job block by
    // that indent and then find `with:` anywhere inside it.
    let blockStart = usesIdx;
    for (let i = usesIdx - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.trim() === "" || /^\s*#/.test(line))
            continue;
        const indent = line.length - line.trimStart().length;
        if (indent < usesIndent)
            break;
        blockStart = i;
    }
    let blockEnd = lines.length;
    for (let i = usesIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "" || /^\s*#/.test(line))
            continue;
        const indent = line.length - line.trimStart().length;
        if (indent < usesIndent) {
            blockEnd = i;
            break;
        }
    }
    const result = {};
    let inWith = false;
    let withIndent = -1;
    for (let i = blockStart; i < blockEnd; i++) {
        const line = lines[i];
        if (line.trim() === "" || /^\s*#/.test(line))
            continue;
        const indent = line.length - line.trimStart().length;
        if (!inWith) {
            const wm = /^(\s*)with:\s*$/.exec(line);
            if (wm && wm[1].length === usesIndent) {
                inWith = true;
                withIndent = -1;
            }
            continue;
        }
        // Inside `with:` — its entries are indented deeper than `with:` itself.
        if (indent <= usesIndent)
            break; // `with:` block ended
        if (withIndent === -1)
            withIndent = indent;
        if (indent !== withIndent)
            continue; // skip nested/continuation lines
        const cm = /^\s*(build|test)-command:\s*(.+?)\s*$/.exec(line);
        if (cm) {
            const value = parseScalar(cm[2]);
            if (isPlausibleCommand(value)) {
                if (cm[1] === "build")
                    result.build = value;
                else
                    result.test = value;
            }
        }
    }
    return result;
}
