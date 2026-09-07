import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  extractFromComment,
  extractFromIssueBody,
  splitSpecifier,
} from "../scripts/parse-rescore-request";

// The re-score request parser is the trust boundary for the on-demand path:
// everything it returns came from an issue body or a comment, both of which
// anyone can write. These cover the splitting and extraction; the npm-grammar
// and keyword gates live behind a network call and are exercised in the
// workflow itself.

test("splitSpecifier: a bare name has no specifier", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin"), {
    name: "signalk-my-plugin",
    specifier: "",
  });
});

test("splitSpecifier: a dist-tag is separated from the name", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@beta"), {
    name: "signalk-my-plugin",
    specifier: "beta",
  });
});

test("splitSpecifier: an exact version is separated from the name", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@2.0.0-rc.1"), {
    name: "signalk-my-plugin",
    specifier: "2.0.0-rc.1",
  });
});

// The scope marker is an `@` at position 0, and splitting on it would leave
// the name empty and the specifier holding the whole package name.
test("splitSpecifier: a scoped name without a specifier stays intact", () => {
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin"), {
    name: "@signalk/tracks-plugin",
    specifier: "",
  });
});

test("splitSpecifier: a scoped name splits on the last @", () => {
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin@next"), {
    name: "@signalk/tracks-plugin",
    specifier: "next",
  });
  assert.deepEqual(splitSpecifier("@signalk/tracks-plugin@3.0.0-beta.0"), {
    name: "@signalk/tracks-plugin",
    specifier: "3.0.0-beta.0",
  });
});

// A trailing `@` is a typo rather than a request for a tag named "". It falls
// back to latest, which is the same thing a bare name does.
test("splitSpecifier: a trailing @ yields an empty specifier", () => {
  assert.deepEqual(splitSpecifier("signalk-my-plugin@"), {
    name: "signalk-my-plugin",
    specifier: "",
  });
});

test("extractFromComment: reads the name after /rescore", () => {
  assert.equal(extractFromComment("/rescore signalk-my-plugin"), "signalk-my-plugin");
});

test("extractFromComment: keeps a specifier attached to the name", () => {
  assert.equal(
    extractFromComment("/rescore @signalk/tracks-plugin@next"),
    "@signalk/tracks-plugin@next",
  );
});

test("extractFromComment: tolerates backtick fencing", () => {
  assert.equal(extractFromComment("/rescore `signalk-my-plugin@beta`"), "signalk-my-plugin@beta");
});

test("extractFromComment: ignores a comment that is not a command", () => {
  assert.equal(extractFromComment("please rescore signalk-my-plugin"), "");
});

test("extractFromIssueBody: reads the answer under the heading", () => {
  const body = ["### npm package name", "", "signalk-my-plugin", "", "### Confirmation", "- [X] yes"].join(
    "\n",
  );
  assert.equal(extractFromIssueBody(body), "signalk-my-plugin");
});

test("extractFromIssueBody: keeps a specifier the author typed", () => {
  const body = "### npm package name\n\n@signalk/tracks-plugin@beta\n";
  assert.equal(extractFromIssueBody(body), "@signalk/tracks-plugin@beta");
});

// GitHub writes CRLF line endings on some clients; splitting on \n alone would
// leave a trailing \r on the extracted name and fail the npm-grammar gate.
test("extractFromIssueBody: handles CRLF line endings", () => {
  assert.equal(extractFromIssueBody("### npm package name\r\n\r\nsignalk-my-plugin\r\n"), "signalk-my-plugin");
});

test("extractFromIssueBody: returns nothing when the heading is absent", () => {
  assert.equal(extractFromIssueBody("just some prose"), "");
});
