import * as fs from 'fs'
import * as path from 'path'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : ''
  }

  return {
    plugin: get('--plugin'),
    pluginVersion: get('--plugin-version'),
    serverSlot: get('--server-slot') as 'stable' | 'master',
    serverVersion: get('--server-version'),
    result: get('--result'),
    reason: get('--reason')
  }
}

function main() {
  const args = parseArgs()
  const resultsPath = path.resolve(__dirname, '..', 'results.json')
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  if (!results[args.plugin]) {
    results[args.plugin] = {}
  }
  if (!results[args.plugin][args.pluginVersion]) {
    results[args.plugin][args.pluginVersion] = {}
  }

  let resultData: Record<string, unknown>
  try {
    resultData = JSON.parse(args.result)
  } catch {
    console.error('Failed to parse --result JSON')
    process.exit(1)
  }

  const slotKey = `server@${args.serverSlot}`
  const slotResult: Record<string, unknown> = {
    tested: new Date().toISOString(),
    triggered_by: args.reason,
    node_version: process.version.replace('v', '').split('.')[0],
    ...(args.serverSlot === 'stable'
      ? { server_version: args.serverVersion }
      : { server_sha: args.serverVersion }),
    installs: resultData.installs,
    install_error: resultData.installError,
    loads: resultData.detection && (resultData.detection as Record<string, unknown>).loads,
    activation_error: resultData.detection && (resultData.detection as Record<string, unknown>).activationError,
    activates: resultData.detection && (resultData.detection as Record<string, unknown>).activates,
    detected_providers: resultData.detection && (resultData.detection as Record<string, unknown>).providers,
    unstubbed_accesses: resultData.detection && (resultData.detection as Record<string, unknown>).unstubbedAccesses,
    has_schema: resultData.detection && (resultData.detection as Record<string, unknown>).hasSchema,
    has_own_tests: resultData.hasOwnTests,
    own_tests_pass: resultData.ownTestsPass,
    has_install_scripts: resultData.hasInstallScripts,
    audit_critical: resultData.auditCritical,
    audit_high: resultData.auditHigh,
    audit_moderate: resultData.auditModerate,
    composite: resultData.composite,
    badges: resultData.badges,
    test_status: resultData.testStatus
  }

  // Remove undefined values
  for (const key of Object.keys(slotResult)) {
    if (slotResult[key] === undefined) delete slotResult[key]
  }

  results[args.plugin][args.pluginVersion][slotKey] = slotResult

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n')
  console.log(`Updated ${args.plugin}@${args.pluginVersion} [${slotKey}] score=${resultData.composite}`)
}

main()
