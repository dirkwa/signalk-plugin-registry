import { after, test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MAX_BUNDLE_FILES,
  checkLegacyDeps,
  findLegacyBaconjs,
  findLegacyReact,
  findSharedReactMajors,
} from "./legacy-deps";

function bacon(range: string) {
  return findLegacyBaconjs([{ pkg: "baconjs", range }]);
}

test("baconjs ranges that cannot reach 3.x are flagged", () => {
  for (const range of [
    "^0.7.88",
    "^1.0.1",
    "~2.0.9",
    "1.0.1",
    "1.x",
    "<3",
    "^2.0.0-beta",
  ]) {
    assert.deepEqual(
      bacon(range),
      { pkg: "baconjs", found: range, required: ">=3" },
      `range: ${range}`,
    );
  }
});

test("baconjs ranges that can resolve to 3.x are not flagged", () => {
  for (const range of [
    "^3.0.0",
    "^3.0.23",
    "3.0.0-beta.1",
    ">=1",
    "^0.7.88 || ^3",
    "*",
    "",
  ]) {
    assert.equal(bacon(range), null, `range: ${JSON.stringify(range)}`);
  }
});

test("baconjs dist-tags and non-registry specs are skipped", () => {
  for (const range of [
    "latest",
    "github:baconjs/bacon.js",
    "git+https://github.com/baconjs/bacon.js.git",
    "file:../bacon",
  ]) {
    assert.equal(bacon(range), null, `range: ${range}`);
  }
});

test("other packages are ignored", () => {
  assert.equal(
    findLegacyBaconjs([{ pkg: "react", range: "^16.13.1" }]),
    null,
  );
});

// Snippets lifted from real published bundles.
const WEBPACK_R16 = 'l("react","16.14.0",(()=>E.e(540).then((()=>()=>E(6540)))))';
// Curried register form emitted by newer webpack (bt-sensors, shelly2, calibration).
const WEBPACK_R16_CURRIED = ')("react","16.14.0"),e[t]=u.length?Promise.all(u)';
const WEBPACK_R19 = 'l("react","19.2.6",(()=>E.e(540)';
// Unminified development build.
const WEBPACK_R16_DEV = 'register("react", "16.14.0", () => (';
const VITE_R19 =
  "n={react:{name:`react`,version:`19.2.8`,scope:[`default`],loaded:!1}}";
const VITE_R16_DQ = 'n={react:{name:"react",version:"16.14.0",scope:["default"]}}';
const VITE_R16_DEV = 'react: { name: "react", version: "16.14.0", scope: ["default"] }';
// import:false remote — consumes the host's React, registers no version.
const CONSUME_ONLY = 'loadSingleton("default", "react", false)';
// requiredVersion arrays and other 16.x strings must not count as a registration.
const REQUIRED_ONLY = '"react",!1,[1,16,14,0]';
// webpack consumes-from-host (import: false) — no version registered.
const CONSUMES_HOST = 'a("default","react",!1,[1,19,2,0])';

test("finds registered React majors in webpack and vite bundles", () => {
  assert.deepEqual(findSharedReactMajors(WEBPACK_R16), [16]);
  assert.deepEqual(findSharedReactMajors(WEBPACK_R16_CURRIED), [16]);
  assert.deepEqual(findSharedReactMajors(WEBPACK_R19), [19]);
  assert.deepEqual(findSharedReactMajors(VITE_R19), [19]);
  assert.deepEqual(findSharedReactMajors(VITE_R16_DQ), [16]);
  assert.deepEqual(findSharedReactMajors(WEBPACK_R16_DEV), [16]);
  assert.deepEqual(findSharedReactMajors(VITE_R16_DEV), [16]);
});

test("consume-only remotes register no React version", () => {
  assert.deepEqual(findSharedReactMajors(CONSUME_ONLY), []);
  assert.deepEqual(findSharedReactMajors(REQUIRED_ONLY), []);
  assert.deepEqual(findSharedReactMajors(CONSUMES_HOST), []);
});

test("React below 19 is flagged, 19 is not", () => {
  assert.deepEqual(findLegacyReact([WEBPACK_R16]), {
    pkg: "react",
    found: "16",
    required: ">=19",
  });
  assert.equal(findLegacyReact([WEBPACK_R19, VITE_R19]), null);
  assert.equal(findLegacyReact([CONSUME_ONLY]), null);
  assert.equal(findLegacyReact([]), null);
});

test("a legacy chunk anywhere in the bundle set is enough", () => {
  assert.equal(findLegacyReact([WEBPACK_R19, VITE_R16_DQ])?.pkg, "react");
});

// --- checkLegacyDeps against on-disk fixtures ---

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(pkg: object, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-deps-"));
  fixtures.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test("plugin with neither is clean", () => {
  const dir = fixture({
    name: "p",
    keywords: ["signalk-node-server-plugin"],
    dependencies: { lodash: "^4" },
  });
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("baconjs in dependencies is flagged, in devDependencies is not", () => {
  const dep = fixture({ name: "p", dependencies: { baconjs: "^0.7.88" } });
  assert.deepEqual(checkLegacyDeps(dep), [
    { pkg: "baconjs", found: "^0.7.88", required: ">=3" },
  ]);
  const peer = fixture({ name: "p", peerDependencies: { baconjs: "^1.0.1" } });
  assert.equal(checkLegacyDeps(peer).length, 1);
  const dev = fixture({ name: "p", devDependencies: { baconjs: "^0.7.88" } });
  assert.deepEqual(checkLegacyDeps(dev), []);
});

test("embedded webapp whose remoteEntry.js registers React 16 is flagged", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-plugin-configurator"] },
    { "public/remoteEntry.js": WEBPACK_R16_CURRIED },
  );
  assert.deepEqual(checkLegacyDeps(dir), [
    { pkg: "react", found: "16", required: ">=19" },
  ]);
});

test("remoteEntry.js at the package root is used when there is no public/", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    { "remoteEntry.js": WEBPACK_R16 },
  );
  assert.equal(checkLegacyDeps(dir)[0]?.pkg, "react");
});

test("vite remote registers React in a chunk that remoteEntry.js imports", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    {
      "public/remoteEntry.js":
        "import{t}from'./assets/dist-x.js';import(`./assets/_virtual_mf-localSharedImportMap-y.js`)",
      "public/assets/dist-x.js": "",
      "public/assets/_virtual_mf-localSharedImportMap-y.js": VITE_R16_DQ,
    },
  );
  assert.equal(checkLegacyDeps(dir)[0]?.pkg, "react");
});

test("references are followed transitively, relative to the importing file", () => {
  // signalk-doctor 1.0.1 shape: remoteEntry.js -> assets/entry chunk ->
  // assets/localSharedImportMap chunk, the second hop written as "./x.js"
  // relative to assets/.
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    {
      "public/remoteEntry.js": 'import("./assets/virtual_mf-REMOTE_ENTRY_ID-a.js")',
      "public/assets/virtual_mf-REMOTE_ENTRY_ID-a.js":
        'import{h}from"./hostInit-b.js";import("./_virtual_mf-localSharedImportMap-c.js")',
      "public/assets/hostInit-b.js": 'import("./_virtual_mf-localSharedImportMap-c.js")',
      "public/assets/_virtual_mf-localSharedImportMap-c.js": VITE_R16_DQ,
    },
  );
  assert.equal(checkLegacyDeps(dir)[0]?.pkg, "react");
});

test("bundles remoteEntry.js does not reference are not consulted", () => {
  // A stale unminified React 16 build left next to a consume-only remote
  // (signalk-ais-navionics-converter 1.0.10) — the browser never loads it.
  const dir = fixture(
    { name: "p", keywords: ["signalk-plugin-configurator"] },
    {
      "public/remoteEntry.js": CONSUMES_HOST,
      "public/main.js": WEBPACK_R16_DEV,
      "public/vendors-node_modules_react_index_js.js": WEBPACK_R16,
    },
  );
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("React 16 remote is ignored without an embedded-webapp keyword", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-webapp"] },
    { "public/remoteEntry.js": WEBPACK_R16 },
  );
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("references outside the webapp root are not followed", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    {
      "public/remoteEntry.js": "import('../chunk.js')",
      "chunk.js": WEBPACK_R16,
    },
  );
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("both findings are reported together", () => {
  const dir = fixture(
    {
      name: "p",
      keywords: ["signalk-plugin-configurator"],
      dependencies: { baconjs: "^0.7.88" },
    },
    { "public/remoteEntry.js": WEBPACK_R16 },
  );
  assert.deepEqual(
    checkLegacyDeps(dir).map((d) => d.pkg),
    ["baconjs", "react"],
  );
});

test("reachable files are capped at MAX_BUNDLE_FILES", () => {
  // remoteEntry.js plus MAX_BUNDLE_FILES - 1 empty chunks fill the budget;
  // the legacy chunk is referenced last and must never be read.
  const files: Record<string, string> = {};
  const refs: string[] = [];
  for (let i = 0; i < MAX_BUNDLE_FILES; i++) {
    refs.push(`import('./c${i}.js')`);
    files[`public/c${i}.js`] = "";
  }
  files[`public/c${MAX_BUNDLE_FILES - 1}.js`] = WEBPACK_R16;
  files["public/remoteEntry.js"] = refs.join(";");
  const dir = fixture({ name: "p", keywords: ["signalk-embeddable-webapp"] }, files);
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("reference cycles terminate", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    {
      "public/remoteEntry.js": "import('./a.js')",
      "public/a.js": "import('./b.js');import('./remoteEntry.js')",
      "public/b.js": "import('./a.js')",
    },
  );
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("symlinked public/, remoteEntry.js and chunks are not followed", () => {
  const outside = fixture({ name: "o" }, { "chunk.js": WEBPACK_R16 });

  const dir = fixture({ name: "p", keywords: ["signalk-embeddable-webapp"] });
  fs.symlinkSync(outside, path.join(dir, "public"));
  assert.deepEqual(checkLegacyDeps(dir), []);

  const dir2 = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    { "public/remoteEntry.js": "import('./chunk.js')" },
  );
  fs.symlinkSync(
    path.join(outside, "chunk.js"),
    path.join(dir2, "public", "chunk.js"),
  );
  assert.deepEqual(checkLegacyDeps(dir2), []);

  const dir3 = fixture({ name: "p", keywords: ["signalk-embeddable-webapp"] });
  fs.mkdirSync(path.join(dir3, "public"));
  fs.symlinkSync(
    path.join(outside, "chunk.js"),
    path.join(dir3, "public", "remoteEntry.js"),
  );
  assert.deepEqual(checkLegacyDeps(dir3), []);
});

test("embedded webapp without a remoteEntry.js is indeterminate", () => {
  const dir = fixture(
    { name: "p", keywords: ["signalk-embeddable-webapp"] },
    { "public/index.html": "" },
  );
  assert.deepEqual(checkLegacyDeps(dir), []);
});

test("missing package.json is indeterminate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-deps-"));
  fixtures.push(dir);
  assert.deepEqual(checkLegacyDeps(dir), []);
});
