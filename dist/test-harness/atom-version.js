"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.atomMentionsVersion = atomMentionsVersion;
// Escape the RegExp metacharacters a semver string can legitimately contain.
// A version comes from the npm registry (a boundary), and prereleases carry
// `.`, `-` and `+` — an unescaped `+` would be read as a quantifier.
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Does a GitHub Releases atom feed contain a release for this exact version?
//
// Minimal atom parse: each <entry> has an <id> like
// tag:github.com,2008:Repository/…/<tag> and a <title>. The version can appear
// in either, and monorepos prefix the tag with the package name, so match on
// the boundary around the version rather than on a fixed set of substrings:
//
//   left  — start, or one of > / : @ - or whitespace. Covers `>1.2.3<`,
//           `/v1.2.3<`, `:v1.2.3<` (plain tags), plus the monorepo
//           conventions `pkg@1.2.3`, `pkg-v1.2.3`, `pkg/v1.2.3`, and a
//           `<title>my-plugin 1.2.3</title>`.
//   right — a lookahead for `<`, whitespace, or end. This is the half that
//           keeps the match honest: it stops `0.1.4` matching inside `0.1.40`
//           and stops it matching `1.2.3-beta.1` (a prerelease is a different
//           version and must not satisfy the check for the release).
//
// Known, accepted false positive: a sibling package in the same monorepo feed
// released at an identical version string matches. Telling them apart would
// need a tag-prefix-to-package-name correlation the atom doesn't reliably
// give us, and would re-break the plain `v1.2.3` case.
function atomMentionsVersion(body, version) {
    const v = version.trim();
    if (!v)
        return false;
    return new RegExp(`(?:^|[>/:@\\-\\s])v?${escapeRegExp(v)}(?=[<\\s]|$)`).test(body);
}
