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
const path = __importStar(require("path"));
const FETCH_TIMEOUT_MS = 20_000;
const GITHUB_CONCURRENCY = 8;
const GITHUB_SLUG_RE = /github\.com[/:]([^/]+)\/([^/.#?]+?)(?:\.git)?(?:[?#/].*)?$/i;
function parseGithubSlug(url) {
    if (!url)
        return undefined;
    const m = GITHUB_SLUG_RE.exec(url);
    if (!m)
        return undefined;
    return { owner: m[1], repo: m[2] };
}
function githubHeaders() {
    const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    const token = process.env.GITHUB_TOKEN;
    if (token && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
}
async function fetchJson(url, headers = {}) {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers
        });
        if (!res.ok) {
            console.error(`[build-api] GET ${url} -> ${res.status}`);
            return undefined;
        }
        return (await res.json());
    }
    catch (err) {
        console.error(`[build-api] GET ${url} failed: ${err.message}`);
        return undefined;
    }
}
async function fetchNpmVersionMeta(pkgName, version) {
    const body = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkgName).replace('%40', '@')}/${encodeURIComponent(version)}`);
    if (!body)
        return undefined;
    const repository_url = typeof body.repository === 'string'
        ? body.repository
        : body.repository?.url;
    const git_head = typeof body.gitHead === 'string' && body.gitHead.length > 0
        ? body.gitHead
        : undefined;
    if (!repository_url && !git_head)
        return undefined;
    return { repository_url, git_head };
}
async function fetchRepositoryUrl(pkgName, version) {
    const meta = await fetchNpmVersionMeta(pkgName, version);
    return meta?.repository_url;
}
async function fetchContributorCount(owner, repo) {
    try {
        const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=1&anon=true`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: githubHeaders() });
        if (!res.ok)
            return undefined;
        const link = res.headers.get('link');
        if (link) {
            const m = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!Number.isNaN(n))
                    return n;
            }
        }
        const body = (await res.json());
        return Array.isArray(body) ? body.length : undefined;
    }
    catch {
        return undefined;
    }
}
async function fetchNpmWeeklyDownloads(pkgName) {
    const body = await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkgName).replace('%40', '@')}`);
    return body && typeof body.downloads === 'number'
        ? body.downloads
        : undefined;
}
const PLUGIN_CI_PATH = '.github/workflows/plugin-ci.yml';
const PLUGIN_CI_REUSABLE = 'SignalK/signalk-server/.github/workflows/plugin-ci.yml';
// Reusable workflows exposed as "<callerJobKey> / <reusableJobName>"
// (e.g. plugins call this with job key `test`, so all jobs come through
// as "test / <name>"). Strip an optional leading "<word> / " prefix
// before matching the canonical job name.
const CALLER_PREFIX_RE = /^[A-Za-z0-9_-]+ \/ /;
const DESKTOP_JOB_RE = /^(Linux|Linux arm64|macOS|Windows) \/ Node (\d+)$/;
const ARMV7_JOB_RE = /^armv7 \(Cerbo GX\) \/ Node (\d+)$/;
const INTEGRATION_JOB_RE = /^Integration \/ signalk-server ([\w.-]+) \/ Node (\d+)$/;
function osLabelToPlatform(label) {
    switch (label) {
        case 'Linux':
            return 'linux-x64';
        case 'Linux arm64':
            return 'linux-arm64';
        case 'macOS':
            return 'macos';
        case 'Windows':
            return 'windows';
        default:
            return undefined;
    }
}
function parseJobName(name) {
    // Strip leading "<callerJobKey> / " prefix added by GitHub when a
    // workflow calls the reusable plugin-ci.yml.
    const stripped = name.replace(CALLER_PREFIX_RE, '');
    const desk = DESKTOP_JOB_RE.exec(stripped);
    if (desk) {
        const platform = osLabelToPlatform(desk[1]);
        if (!platform)
            return undefined;
        const node = parseInt(desk[2], 10);
        if (Number.isNaN(node))
            return undefined;
        return { platform, node };
    }
    const armv7 = ARMV7_JOB_RE.exec(stripped);
    if (armv7) {
        const node = parseInt(armv7[1], 10);
        if (Number.isNaN(node))
            return undefined;
        return { platform: 'armv7-cerbo', node };
    }
    const integ = INTEGRATION_JOB_RE.exec(stripped);
    if (integ) {
        const node = parseInt(integ[2], 10);
        if (Number.isNaN(node))
            return undefined;
        return { platform: 'integration', node, server_version: integ[1] };
    }
    return undefined;
}
function jobConclusionFromGithub(conclusion, status) {
    if (status && (status === 'queued' || status === 'in_progress')) {
        return 'in_progress';
    }
    switch (conclusion) {
        case 'success':
        case 'failure':
        case 'skipped':
        case 'cancelled':
            return conclusion;
        default:
            return null;
    }
}
function commitUrl(owner, repo, sha) {
    return `https://github.com/${owner}/${repo}/commit/${sha}`;
}
async function fetchWorkflowRunsForSha(owner, repo, sha) {
    const body = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`, githubHeaders());
    if (!body)
        return undefined;
    return body.workflow_runs ?? [];
}
async function fetchRunJobs(owner, repo, runId) {
    const body = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?per_page=100`, githubHeaders());
    return body?.jobs;
}
// Matches "owner/repo/.github/workflows/<file>" optionally followed by
// "@<ref>" (e.g. "@master"). The reusable plugin-ci is referenced by
// callers via `uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@<ref>`,
// which surfaces in the GitHub API as referenced_workflows[].path with
// the @ref suffix included.
function strippedReusablePath(path) {
    if (!path)
        return '';
    const at = path.indexOf('@');
    return (at >= 0 ? path.substring(0, at) : path).toLowerCase();
}
function pickPluginCiRun(runs) {
    const target = PLUGIN_CI_REUSABLE.toLowerCase();
    const matching = runs.filter((r) => (r.referenced_workflows ?? []).some((rw) => strippedReusablePath(rw.path) === target));
    if (matching.length === 0)
        return undefined;
    return matching.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
}
async function fetchPluginCi(owner, repo, gitHead) {
    if (!gitHead)
        return { status: 'no-githead' };
    const runs = await fetchWorkflowRunsForSha(owner, repo, gitHead);
    if (runs === undefined || runs.length === 0) {
        return {
            status: 'no-run',
            head_sha: gitHead,
            commit_url: commitUrl(owner, repo, gitHead)
        };
    }
    const run = pickPluginCiRun(runs);
    if (!run) {
        // Some run exists for this SHA but none of them exercise the
        // SignalK plugin-ci workflow. Most likely the plugin author hasn't
        // adopted the upstream workflow.
        const anyRun = runs[0];
        return {
            status: 'no-plugin-ci',
            head_sha: gitHead,
            workflow_run_url: anyRun.html_url ?? commitUrl(owner, repo, gitHead)
        };
    }
    const workflow_run_url = run.html_url ?? commitUrl(owner, repo, gitHead);
    if (run.status === 'queued' || run.status === 'in_progress') {
        return {
            status: 'in-progress',
            head_sha: gitHead,
            workflow_run_url,
            tested_at: run.updated_at
        };
    }
    const ghJobs = await fetchRunJobs(owner, repo, run.id);
    const jobs = [];
    for (const j of ghJobs ?? []) {
        if (typeof j.name !== 'string')
            continue;
        const parsed = parseJobName(j.name);
        if (!parsed)
            continue;
        const conclusion = jobConclusionFromGithub(j.conclusion, j.status);
        const out = {
            platform: parsed.platform,
            node: parsed.node,
            conclusion
        };
        if (parsed.server_version)
            out.server_version = parsed.server_version;
        if (j.html_url)
            out.job_url = j.html_url;
        jobs.push(out);
    }
    return {
        status: 'ok',
        head_sha: gitHead,
        commit_url: commitUrl(owner, repo, gitHead),
        workflow_run_url,
        tested_at: run.updated_at ?? '',
        workflow_ref: typeof run.head_branch === 'string'
            ? `refs/heads/${run.head_branch}`
            : 'refs/heads/master',
        jobs
    };
}
const PLUGIN_CI_CACHE_TTL_HOURS = 24;
function loadPluginCiCache(rootDir) {
    const cachePath = path.join(rootDir, 'data', 'plugin-ci-cache.json');
    try {
        if (!fs.existsSync(cachePath))
            return {};
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
    catch (err) {
        console.error(`[build-api] failed to load plugin-ci cache: ${err.message}`);
        return {};
    }
}
function savePluginCiCache(rootDir, cache) {
    const cachePath = path.join(rootDir, 'data', 'plugin-ci-cache.json');
    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
    }
    catch (err) {
        console.error(`[build-api] failed to save plugin-ci cache: ${err.message}`);
    }
}
function pluginCiCacheValid(entry, expectedSha) {
    if (!entry || !expectedSha)
        return false;
    if (entry.head_sha !== expectedSha)
        return false;
    const fetched = Date.parse(entry.fetched_at);
    if (Number.isNaN(fetched))
        return false;
    const ageHours = (Date.now() - fetched) / (1000 * 60 * 60);
    return ageHours < PLUGIN_CI_CACHE_TTL_HOURS;
}
const rateLimitState = {
    remaining: 5000,
    budget_low: false
};
// Watch X-RateLimit-Remaining when GitHub responses pass through fetchJson
// elsewhere. We probe the headers via a one-off fetch right before each
// plugin-ci attempt so we can stop cleanly without exhausting the quota.
async function checkGithubRateLimit() {
    try {
        const res = await fetch('https://api.github.com/rate_limit', {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: githubHeaders()
        });
        if (!res.ok)
            return;
        const body = (await res.json());
        const rem = body.resources?.core?.remaining;
        if (typeof rem === 'number') {
            rateLimitState.remaining = rem;
            if (rem < 100 && !rateLimitState.budget_low) {
                rateLimitState.budget_low = true;
                console.warn(`[build-api] GitHub rate-limit remaining ${rem} < 100 — stopping plugin-ci fetches; existing cache preserved`);
            }
        }
    }
    catch {
        // network blip — don't change state
    }
}
async function collectRawMetrics(pkgName, version) {
    const result = {};
    const meta = await fetchNpmVersionMeta(pkgName, version);
    const repoUrl = meta?.repository_url;
    const gitHead = meta?.git_head;
    if (gitHead)
        result.git_head = gitHead;
    const slug = parseGithubSlug(repoUrl);
    if (slug) {
        const githubHttps = `https://github.com/${slug.owner}/${slug.repo}`;
        result.github_url = githubHttps;
        const repo = await fetchJson(`https://api.github.com/repos/${slug.owner}/${slug.repo}`, githubHeaders());
        if (repo) {
            if (typeof repo.stargazers_count === 'number') {
                result.stars = repo.stargazers_count;
            }
            if (typeof repo.open_issues_count === 'number') {
                result.open_issues = repo.open_issues_count;
            }
        }
        const contributors = await fetchContributorCount(slug.owner, slug.repo);
        if (typeof contributors === 'number') {
            result.contributors = contributors;
        }
    }
    const dl = await fetchNpmWeeklyDownloads(pkgName);
    if (typeof dl === 'number')
        result.downloads_per_week = dl;
    return result;
}
async function enrichSummariesWithMetrics(summaries, pluginCiCache) {
    if (process.env.SKIP_RAW_METRICS === 'true') {
        console.log('[build-api] SKIP_RAW_METRICS=true — skipping upstream fetches');
        return;
    }
    if (!process.env.GITHUB_TOKEN) {
        console.log('[build-api] GITHUB_TOKEN not set — fetching GitHub metrics unauthenticated, limit 60/hr');
    }
    let i = 0;
    async function worker() {
        while (true) {
            const idx = i++;
            if (idx >= summaries.length)
                return;
            const s = summaries[idx];
            try {
                const m = await collectRawMetrics(s.name, s.version);
                if (m.stars !== undefined)
                    s.stars = m.stars;
                if (m.open_issues !== undefined)
                    s.open_issues = m.open_issues;
                if (m.contributors !== undefined)
                    s.contributors = m.contributors;
                if (m.downloads_per_week !== undefined) {
                    s.downloads_per_week = m.downloads_per_week;
                }
                if (m.github_url)
                    s.github_url = m.github_url;
                // plugin-ci matrix. Cache by gitHead so a full-run that re-tests
                // every plugin still only touches GitHub for plugins whose SHA
                // moved since yesterday.
                const slug = parseGithubSlug(m.github_url);
                if (slug && m.git_head) {
                    const cached = pluginCiCache[s.name];
                    if (pluginCiCacheValid(cached, m.git_head)) {
                        s.plugin_ci = cached.payload;
                    }
                    else if (rateLimitState.budget_low) {
                        // honour previously-cached value when rate-limited
                        if (cached)
                            s.plugin_ci = cached.payload;
                    }
                    else {
                        const ci = await fetchPluginCi(slug.owner, slug.repo, m.git_head);
                        s.plugin_ci = ci;
                        pluginCiCache[s.name] = {
                            head_sha: m.git_head,
                            fetched_at: new Date().toISOString(),
                            payload: ci
                        };
                    }
                }
                else if (m.git_head) {
                    // gitHead known but no GitHub repo (rare). Mark explicitly.
                    s.plugin_ci = { status: 'no-githead' };
                }
                else {
                    s.plugin_ci = { status: 'no-githead' };
                }
            }
            catch (err) {
                console.error(`[build-api] metrics for ${s.name} failed: ${err.message}`);
            }
        }
    }
    // Probe rate limit once at the start so workers know whether to skip.
    await checkGithubRateLimit();
    await Promise.all(Array.from({ length: GITHUB_CONCURRENCY }, () => worker()));
}
// Plugins that don't run the SignalK plugin-ci workflow give us no
// per-platform compatibility data, so the App Store can't show whether
// they actually work on Linux/macOS/Windows/Cerbo. Apply a flat -10
// penalty to nudge authors to opt in. Applied at publish time so that
// score changes propagate without re-running tests.
const PLUGIN_CI_PENALTY = 10;
function applyPluginCiPenalty(composite, badges, pluginCi) {
    if (!pluginCi || pluginCi.status === 'ok' || pluginCi.status === 'in-progress') {
        return { composite, badges };
    }
    const adjusted = Math.max(0, composite - PLUGIN_CI_PENALTY);
    const newBadges = badges.includes('no-plugin-ci')
        ? badges
        : [...badges, 'no-plugin-ci'];
    return { composite: adjusted, badges: newBadges };
}
async function main() {
    const rootDir = process.cwd();
    const resultsPath = path.join(rootDir, 'results.json');
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    const apiDir = path.join(rootDir, 'api');
    const pluginsDir = path.join(apiDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const summaries = [];
    const allVersionsByPlugin = {};
    for (const [pluginName, versions] of Object.entries(results)) {
        // Find latest non-outdated version
        const latestVersion = Object.entries(versions)
            .filter(([_, data]) => !data.outdated)
            .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
            .map(([v]) => v)[0];
        if (!latestVersion)
            continue;
        const versionData = versions[latestVersion];
        const stableResult = versionData['server@stable'];
        const masterResult = versionData['server@master'];
        if (!stableResult || typeof stableResult !== 'object')
            continue;
        const summary = {
            name: pluginName,
            version: latestVersion,
            composite_stable: stableResult.composite || 0,
            badges_stable: stableResult.badges || [],
            test_status: stableResult.test_status || 'none',
            last_tested: stableResult.tested || '',
            installs: stableResult.installs || false,
            loads: !!stableResult.loads,
            activates: !!stableResult.activates,
            providers: stableResult.detected_providers || [],
            error: stableResult.load_error || stableResult.activation_error || stableResult.install_error || undefined
        };
        if (masterResult && typeof masterResult === 'object') {
            summary.composite_master = masterResult.composite || 0;
            summary.badges_master = masterResult.badges || [];
        }
        summaries.push(summary);
        allVersionsByPlugin[pluginName] = versions;
    }
    // Fetch upstream metrics (GitHub + npm) once per plugin here, using the
    // CI GITHUB_TOKEN. See collectRawMetrics above for the methodology.
    console.log(`[build-api] fetching raw metrics for ${summaries.length} plugins...`);
    const pluginCiCache = loadPluginCiCache(rootDir);
    await enrichSummariesWithMetrics(summaries, pluginCiCache);
    // Persist any newly-fetched plugin-ci entries so subsequent runs skip
    // the GitHub fetch when gitHead hasn't changed (typical full-run is
    // 5-10 plugins with new SHAs out of ~340 with GitHub repos).
    savePluginCiCache(rootDir, pluginCiCache);
    // Apply the plugin-ci penalty on the summary scores. Per-version slot
    // scores in the detail JSON are adjusted in the per-plugin write loop
    // below so both the index and detail views stay consistent.
    for (const summary of summaries) {
        const stableAdjusted = applyPluginCiPenalty(summary.composite_stable, summary.badges_stable, summary.plugin_ci);
        summary.composite_stable = stableAdjusted.composite;
        summary.badges_stable = stableAdjusted.badges;
        if (summary.composite_master !== undefined) {
            const masterAdjusted = applyPluginCiPenalty(summary.composite_master, summary.badges_master ?? [], summary.plugin_ci);
            summary.composite_master = masterAdjusted.composite;
            summary.badges_master = masterAdjusted.badges;
        }
    }
    // Now write per-plugin detail JSONs with the metrics merged into the
    // top-level document, so signalk-server's raw-metrics client can pull
    // them from either the index or the per-plugin file.
    for (const summary of summaries) {
        const versions = allVersionsByPlugin[summary.name];
        // Deep-copy each slot before mutating so we don't pollute results.json
        // (which is the raw test-result store, kept intact).
        const versionsCopy = Object.fromEntries(Object.entries(versions).map(([ver, data]) => {
            const copy = {};
            for (const [k, v] of Object.entries(data)) {
                copy[k] = v && typeof v === 'object' ? { ...v } : v;
            }
            for (const [slotKey, slot] of Object.entries(copy)) {
                if (slot &&
                    typeof slot === 'object' &&
                    'composite' in slot) {
                    const s = slot;
                    const adjusted = applyPluginCiPenalty(s.composite, s.badges ?? [], summary.plugin_ci);
                    s.composite = adjusted.composite;
                    s.badges = adjusted.badges;
                    copy[slotKey] = s;
                }
            }
            return [ver, copy];
        }));
        const pluginDetail = {
            name: summary.name,
            versions: versionsCopy
        };
        if (summary.stars !== undefined)
            pluginDetail.stars = summary.stars;
        if (summary.open_issues !== undefined)
            pluginDetail.open_issues = summary.open_issues;
        if (summary.contributors !== undefined)
            pluginDetail.contributors = summary.contributors;
        if (summary.downloads_per_week !== undefined) {
            pluginDetail.downloads_per_week = summary.downloads_per_week;
        }
        if (summary.github_url)
            pluginDetail.github_url = summary.github_url;
        if (summary.plugin_ci)
            pluginDetail.plugin_ci = summary.plugin_ci;
        const safeFilename = summary.name.replace(/^@/, '').replace(/\//g, '__');
        fs.writeFileSync(path.join(pluginsDir, `${safeFilename}.json`), JSON.stringify(pluginDetail, null, 2) + '\n');
    }
    // Sort by composite score descending
    summaries.sort((a, b) => b.composite_stable - a.composite_stable);
    // Find server version from first result
    let serverVersion = '?';
    for (const [, versions] of Object.entries(results)) {
        for (const [, data] of Object.entries(versions)) {
            const s = data['server@stable'];
            if (s && typeof s === 'object' && s.server_version) {
                serverVersion = s.server_version;
                break;
            }
        }
        if (serverVersion !== '?')
            break;
    }
    const index = {
        generated: new Date().toISOString(),
        server_version: serverVersion,
        plugin_count: summaries.length,
        plugins: summaries
    };
    fs.writeFileSync(path.join(apiDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    // Generate index.html
    const badgeColors = {
        'compatible': '#28a745',
        'loads': '#17a2b8',
        'activates': '#007bff',
        'has-providers': '#6f42c1',
        'tested': '#28a745',
        'tests-failing': '#dc3545',
        'npm-audit-ok': '#28a745',
        'audit-moderate': '#ffc107',
        'audit-high': '#ffc107',
        'audit-critical': '#dc3545',
        'has-changelog': '#17a2b8',
        'has-screenshots': '#17a2b8',
        'broken': '#dc3545'
    };
    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function npmUrl(name) {
        return `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
    }
    function detailUrl(name) {
        const safe = name.replace(/^@/, '').replace(/\//g, '__');
        return `plugins/${safe}.json`;
    }
    function scoreBar(score) {
        const color = score >= 80 ? '#28a745' : score >= 60 ? '#ffc107' : score >= 40 ? '#fd7e14' : '#dc3545';
        return `<div style="display:inline-block;width:60px;height:14px;background:#eee;border-radius:3px;overflow:hidden;vertical-align:middle" title="${score}/100"><div style="width:${score}%;height:100%;background:${color}"></div></div> <strong>${score}</strong>`;
    }
    function statusIcon(ok) {
        if (ok === true)
            return '<span style="color:#28a745">&#10003;</span>';
        if (ok === false)
            return '<span style="color:#dc3545">&#10007;</span>';
        return '<span style="color:#999">&#8211;</span>';
    }
    function badgeSpan(badge) {
        const bg = badgeColors[badge] || '#6c757d';
        return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${bg};color:#fff;font-size:0.75em;margin:1px">${esc(badge)}</span>`;
    }
    function testStatusCell(status) {
        if (status === 'passing')
            return '<span style="color:#28a745">passing</span>';
        if (status === 'failing')
            return '<span style="color:#dc3545">failing</span>';
        if (status === 'not-runnable')
            return '<span style="color:#999" title="Tests exist in source but test runner (jest/mocha/etc) is a devDependency not included in the published package">has tests</span>';
        return '<span style="color:#999">none</span>';
    }
    const passing = summaries.filter(s => s.composite_stable >= 80).length;
    const ok = summaries.filter(s => s.composite_stable >= 50 && s.composite_stable < 80).length;
    const low = summaries.filter(s => s.composite_stable > 0 && s.composite_stable < 50).length;
    const broken = summaries.filter(s => s.composite_stable === 0).length;
    const rows = summaries.map((s, i) => {
        const errorCell = s.error
            ? `<span style="color:#dc3545;font-size:0.8em" title="${esc(s.error)}">${esc(s.error.split('\n')[0].slice(0, 60))}${s.error.length > 60 ? '...' : ''}</span>`
            : '';
        const providerCell = s.providers.length > 0
            ? s.providers.map(p => `<span style="display:inline-block;padding:1px 4px;border-radius:2px;background:#e9ecef;font-size:0.75em;margin:1px">${esc(p)}</span>`).join(' ')
            : '';
        return `<tr>
      <td style="text-align:right;color:#999">${i + 1}</td>
      <td>${scoreBar(s.composite_stable)}</td>
      <td><a href="${npmUrl(s.name)}" target="_blank">${esc(s.name)}</a><br><span style="color:#999;font-size:0.8em">${esc(s.version)}</span></td>
      <td style="text-align:center">${statusIcon(s.installs)}</td>
      <td style="text-align:center">${statusIcon(s.loads)}</td>
      <td style="text-align:center">${statusIcon(s.activates)}</td>
      <td style="text-align:center">${testStatusCell(s.test_status)}</td>
      <td>${s.badges_stable.map(b => badgeSpan(b)).join(' ')}</td>
      <td>${providerCell}</td>
      <td>${errorCell}</td>
      <td><a href="${detailUrl(s.name)}" style="font-size:0.8em">json</a></td>
    </tr>`;
    }).join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signal K Plugin Registry</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; color: #333; }
    h1 { margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 16px; }
    .stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat { padding: 8px 16px; border-radius: 6px; background: #f8f9fa; border: 1px solid #dee2e6; }
    .stat strong { font-size: 1.2em; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th { background: #f8f9fa; position: sticky; top: 0; z-index: 1; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
    tr:hover { background: #f8f9fa; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .api-links { margin-bottom: 16px; font-size: 0.9em; }
    .api-links a { margin-right: 12px; }
  </style>
</head>
<body>
  <h1>Signal K Plugin Registry</h1>
  <p class="subtitle">Automated compatibility testing for ${summaries.length} Signal K server plugins &mdash; generated ${new Date().toISOString().split('T')[0]}</p>

  <div class="stats">
    <div class="stat"><strong style="color:#28a745">${passing}</strong> score &ge; 80</div>
    <div class="stat"><strong style="color:#ffc107">${ok}</strong> score 50&ndash;79</div>
    <div class="stat"><strong style="color:#fd7e14">${low}</strong> score 1&ndash;49</div>
    <div class="stat"><strong style="color:#dc3545">${broken}</strong> broken</div>
    <div class="stat">Tested against <strong>server v${index.server_version || '?'}</strong> on Node 24</div>
  </div>

  <div class="api-links">
    <a href="guide.html"><strong>Plugin Quality Guide</strong></a> &middot;
    API: <a href="index.json">index.json</a> &middot;
    <a href="https://github.com/dirkwa/signalk-plugin-registry">GitHub repo</a>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Score</th>
        <th>Plugin</th>
        <th title="npm install succeeds">Inst</th>
        <th title="Constructor returns plugin object">Load</th>
        <th title="start() completes without error">Act</th>
        <th title="Plugin's own test suite">Tests</th>
        <th>Badges</th>
        <th>Providers</th>
        <th>Error</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
    fs.writeFileSync(path.join(apiDir, 'index.html'), html);
    generateGuide(apiDir);
    console.log(`Built API: ${summaries.length} plugins`);
    for (const s of summaries) {
        console.log(`  ${s.composite_stable.toString().padStart(3)} ${s.name}@${s.version} [${s.badges_stable.join(', ')}]`);
    }
}
function generateGuide(apiDir) {
    const guide = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugin Quality Guide - Signal K Plugin Registry</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px auto; max-width: 800px; color: #333; line-height: 1.6; }
    h1 { margin-bottom: 4px; }
    h2 { border-bottom: 1px solid #dee2e6; padding-bottom: 6px; margin-top: 32px; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; margin: 12px 0; }
    th { background: #f8f9fa; }
    th, td { padding: 6px 10px; border: 1px solid #dee2e6; text-align: left; }
    code { background: #f1f3f5; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 12px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; }
    pre code { background: none; padding: 0; }
    .back { font-size: 0.9em; margin-bottom: 16px; }
    .tip { background: #e8f5e9; border-left: 4px solid #28a745; padding: 8px 12px; margin: 12px 0; border-radius: 0 4px 4px 0; }
  </style>
</head>
<body>
  <div class="back"><a href="index.html">&larr; Back to results</a></div>
  <h1>Plugin Quality Guide</h1>
  <p>Practical tips to improve your Signal K plugin's registry score. Most fixes take less than 5 minutes.</p>

  <h2>Scoring Breakdown</h2>
  <table>
    <thead><tr><th>Tier</th><th>Points</th><th>How to pass</th></tr></thead>
    <tbody>
      <tr><td>Install</td><td>20</td><td><code>npm install --ignore-scripts</code> succeeds</td></tr>
      <tr><td>Load</td><td>15</td><td>Module exports a function that returns <code>{id, name, start, stop}</code></td></tr>
      <tr><td>Activate</td><td>15</td><td><code>start(config)</code> completes without error &mdash; config is populated from your schema defaults</td></tr>
      <tr><td>Schema</td><td>5</td><td><code>plugin.schema</code> returns a JSON Schema object</td></tr>
      <tr><td>Tests</td><td>25</td><td><code>npm test</code> passes (biggest single tier &mdash; see below)</td></tr>
      <tr><td>Security</td><td>20</td><td><code>npm audit</code> finds no high or critical vulnerabilities</td></tr>
      <tr><td>Changelog</td><td>&minus;5 if missing</td><td>Ship a <code>CHANGELOG.md</code> or publish a <a href="https://github.com/SignalK/signalk-server/pull/2615" target="_blank">GitHub Release</a> matching the version tag</td></tr>
      <tr><td>Screenshots</td><td>&minus;5 if missing</td><td>Declare <code>signalk.screenshots</code> (array of package-relative paths) in <code>package.json</code></td></tr>
    </tbody>
  </table>

  <h2>Quick Wins</h2>

  <h3>1. Ship release notes (avoid &minus;5)</h3>
  <p>The registry looks for a <code>CHANGELOG.md</code> in the published package first, and falls back to the public GitHub Releases feed for the repo &mdash; so either path works. The <a href="https://github.com/SignalK/signalk-server/pull/2615" target="_blank">recommended</a> approach is GitHub Releases driven by a tag push, with <code>softprops/action-gh-release@v2</code> and <code>generate_release_notes: true</code>. A plain <code>CHANGELOG.md</code> at the repo root (Keep a Changelog style) is equally accepted.</p>

  <h3>2. Add screenshots (avoid &minus;5)</h3>
  <p>Declare them in <code>package.json</code>:</p>
  <pre><code>"signalk": {
  "displayName": "My Plugin",
  "appIcon": "./assets/icon-128.png",
  "screenshots": [
    "./docs/screenshots/main.png",
    "./docs/screenshots/config.png"
  ]
}</code></pre>
  <p>Paths must be package-relative and the files must be included in the published tarball (check your <code>files</code> field or <code>.npmignore</code>). The AppStore shows the first screenshot as the hero image.</p>

  <h3>3. Fix npm audit issues</h3>
  <pre><code>npm audit
npm audit fix</code></pre>
  <p>Most issues come from transitive dependencies. Update your direct dependencies first. If a vulnerability is in a deep transitive dep you don't control, consider whether you really need that dependency.</p>

  <h3>4. Add schema defaults</h3>
  <p>Every property in your schema should have a <code>default</code> value. The registry extracts these and passes them to <code>start()</code>. If your plugin crashes without them, it loses 15 points.</p>
  <pre><code>schema: {
  type: 'object',
  properties: {
    interval: {
      type: 'number',
      title: 'Update interval (seconds)',
      default: 60
    }
  }
}</code></pre>
  <p>See <a href="https://demo.signalk.org/documentation/develop/plugins/configuration.html">Plugin Configuration &amp; Schemas</a> for full details.</p>

  <h3>5. Guard start() against missing config</h3>
  <p>Even with schema defaults, defensive coding helps:</p>
  <pre><code>start(config) {
  const interval = config.interval ?? 60
  const items = config.items || []
}</code></pre>

  <h2>Adding Tests (25 points)</h2>
  <p>The registry clones your source repo and runs <code>npm test</code>. The easiest approach uses Node's built-in test runner &mdash; zero dependencies needed.</p>

  <h3>TypeScript (recommended)</h3>
  <p>Create <code>test/plugin.test.ts</code>:</p>
  <pre><code>import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import pluginFactory from '../src/index'

describe('plugin', () => {
  const app = { debug: () => {}, error: () => {} } as any
  const plugin = pluginFactory(app)

  it('has required interface', () => {
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
    assert.ok(plugin.id)
  })

  it('starts and stops without error', () => {
    plugin.start({}, () => {})
    plugin.stop()
  })
})</code></pre>
  <p>Add to <code>package.json</code>:</p>
  <pre><code>"scripts": {
  "build": "tsc",
  "test": "tsc &amp;&amp; node --test dist/test/plugin.test.js"
}</code></pre>
  <p>The registry clones your source repo, runs <code>npm install</code> and <code>npm run build</code>, then <code>npm test</code> &mdash; so <code>typescript</code> from your devDependencies is available.</p>

  <h3>JavaScript</h3>
  <p>Create <code>test/plugin.test.js</code>:</p>
  <pre><code>const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const pluginFactory = require('../plugin/index.js')

describe('plugin', () => {
  const app = { debug: () => {}, error: () => {} }
  const plugin = pluginFactory(app)

  it('has required interface', () => {
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
    assert.ok(plugin.id)
  })

  it('starts and stops without error', () => {
    plugin.start({}, () => {})
    plugin.stop()
  })
})</code></pre>
  <p>Add to <code>package.json</code>:</p>
  <pre><code>"scripts": {
  "test": "node --test test/plugin.test.js"
}</code></pre>

  <div class="tip">~15 lines, no devDependencies, worth 25 points. Extend with tests for your actual plugin logic from here.</div>
  <p><strong>Why node:test?</strong> Published npm packages don't include devDependencies, so jest/mocha won't be available when the registry installs your plugin. The registry clones your source repo to run tests, but <code>node:test</code> is built into Node and always available.</p>

  <h2>Common Issues</h2>

  <h3>activation error: Cannot read properties of undefined</h3>
  <p>Your <code>start()</code> assumes config has nested objects that don't exist yet. Add <code>default</code> values to nested properties in your schema, or use optional chaining (<code>config.options?.speed ?? 5</code>).</p>

  <h3>tests: not-runnable</h3>
  <p>Your test runner (jest, mocha, vitest) isn't installed because devDependencies aren't available. Switch to <code>node:test</code> (built-in) or ensure the test command works after a fresh <code>npm install</code>.</p>

  <h3>audit-high or audit-critical</h3>
  <p>Run <code>npm audit</code> locally. Usually it's a transitive dependency. Try <code>npm audit fix</code> or update the parent dependency that pulls it in.</p>

  <h3>Score didn't improve after a fix?</h3>
  <p>The registry retests when a new version is published to npm. Bump your version and publish. Alternatively, results older than 7 days are automatically retested on the nightly run.</p>

  <h2>Further Reading</h2>
  <ul>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/">Signal K Plugin Development</a></li>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/configuration.html">Plugin Configuration &amp; Schemas</a></li>
    <li><a href="https://demo.signalk.org/documentation/develop/plugins/publishing.html">Publishing to the AppStore</a></li>
    <li><a href="https://nodejs.org/docs/latest-v24.x/api/test.html">Node.js 24 Test Runner documentation</a></li>
    <li><a href="https://github.com/dirkwa/signalk-plugin-registry">Registry source code</a></li>
  </ul>

  <div class="back" style="margin-top: 32px"><a href="index.html">&larr; Back to results</a></div>
</body>
</html>`;
    fs.writeFileSync(path.join(apiDir, 'guide.html'), guide);
}
main().catch((err) => {
    console.error('[build-api] fatal:', err);
    process.exit(1);
});
