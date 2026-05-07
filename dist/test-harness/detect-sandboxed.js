"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const detect_providers_1 = require("./detect-providers");
const pluginPath = process.argv[2];
const outputFile = process.argv[3];
if (!pluginPath || !outputFile) {
    console.error("Usage: node detect-sandboxed.js <plugin-path> <output-file>");
    process.exit(1);
}
(0, detect_providers_1.detectProviders)(pluginPath)
    .then((result) => {
    require("fs").writeFileSync(outputFile, JSON.stringify(result));
    process.exit(0);
})
    .catch((err) => {
    console.error(`[detect-sandboxed] ${err.message || err}`);
    process.exit(1);
});
