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
const fs = __importStar(require("fs"));
async function resolveStable() {
    const res = await fetch('https://registry.npmjs.org/signalk-server/latest');
    if (!res.ok)
        throw new Error(`npm registry returned ${res.status}`);
    const data = await res.json();
    return data.version;
}
async function resolveMaster() {
    const res = await fetch('https://api.github.com/repos/SignalK/signalk-server/commits/master', { headers: { Accept: 'application/vnd.github.sha' } });
    if (!res.ok)
        throw new Error(`GitHub API returned ${res.status}`);
    const sha = await res.text();
    return sha.trim().slice(0, 7);
}
async function main() {
    const stableVersion = await resolveStable();
    const masterSha = await resolveMaster();
    const output = [
        `stable_version=${stableVersion}`,
        `master_sha=${masterSha}`
    ].join('\n');
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
    }
    else {
        console.log(`stable_version=${stableVersion}`);
        console.log(`master_sha=${masterSha}`);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
