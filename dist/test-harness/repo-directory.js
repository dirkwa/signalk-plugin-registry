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
exports.sanitizeRepoDirectory = sanitizeRepoDirectory;
exports.isWorkspaceLinked = isWorkspaceLinked;
exports.resolveWithinClone = resolveWithinClone;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// npm's standard field for a package published from a subdirectory of its
// repository: `repository: { url, directory }`. The value is self-declared,
// unverified npm metadata — i.e. attacker-controlled — so it is validated
// here before it is ever joined onto a path.
//
// It is never interpolated into a shell string (it only ever becomes an
// execSync/runSandboxedStep `cwd`, which is an execve argument), so the live
// risk is path traversal rather than command injection. Anything that fails
// a rule returns null, and the caller falls back to the repository root —
// exactly the behaviour that existed before this field was honoured, so a
// stale or malformed value can never make things worse than they were.
const MAX_LENGTH = 200;
// Word characters plus `.`, `-` and `/`. Rejects, by construction, every
// shell metacharacter, whitespace, NUL, glob character, `~` (home
// expansion), `:` (Windows drive / alternate data stream) and all
// non-ASCII — which also disposes of homoglyph and RTL-override tricks.
const ALLOWED = /^[A-Za-z0-9._/-]+$/;
function sanitizeRepoDirectory(raw) {
    if (typeof raw !== "string")
        return null;
    let value = raw.trim();
    if (!value || value.length > MAX_LENGTH)
        return null;
    if (value.startsWith("./"))
        value = value.slice(2);
    if (value.endsWith("/"))
        value = value.slice(0, -1);
    if (!value)
        return null;
    if (!ALLOWED.test(value))
        return null;
    if (value.startsWith("/"))
        return null;
    // Segment-wise rather than a substring scan: this rejects `a/../../b` while
    // still accepting a directory legitimately named `foo..bar`. Empty segments
    // additionally kill `a//b`.
    const segments = value.split("/");
    if (segments.some((s) => s === "" || s === "." || s === ".."))
        return null;
    return value;
}
// Did the root install cover this subdirectory? True only when the
// subdirectory is a real npm workspace of the root, which npm records by
// linking the package back in at <root>/node_modules/<name>.
//
// Checking for the link rather than for `<packageDir>/node_modules` is
// deliberate: npm hoists a workspace's dependencies to the root, so a
// workspace package normally has no node_modules of its own, and the
// intuitive check would re-install exactly the case it means to skip.
function isWorkspaceLinked(sourceDir, packageDir) {
    try {
        const name = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8")).name;
        if (typeof name !== "string" || !name)
            return false;
        const link = path.join(sourceDir, "node_modules", name);
        return fs.realpathSync(link) === fs.realpathSync(packageDir);
    }
    catch {
        return false;
    }
}
// Resolve a sanitized subdirectory against the clone and prove the result is
// contained by it. sanitizeRepoDirectory already makes traversal unreachable;
// this is the invariant that actually matters, so it is asserted rather than
// assumed. realpath is used so a symlink inside the clone can't escape either.
function resolveWithinClone(sourceDir, directory) {
    const candidate = path.resolve(sourceDir, directory);
    try {
        const root = fs.realpathSync(sourceDir);
        const resolved = fs.realpathSync(candidate);
        if (resolved !== root && !resolved.startsWith(root + path.sep))
            return null;
        // Return the resolved path, not the candidate: the containment guarantee
        // is about the resolved one, and handing back a path that still contains
        // a symlink would mean callers validate one location and use another.
        return resolved;
    }
    catch {
        // The subdirectory doesn't exist in the clone (e.g. renamed after the
        // version under test was published).
        return null;
    }
}
