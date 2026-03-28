import { detectProviders, DetectionResult } from './detect-providers'
import { computeScore, TestResults } from './score'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import * as os from 'os'

interface RunResult {
  detection: DetectionResult
  installs: boolean
  installError?: string
  auditCritical: number
  auditHigh: number
  auditModerate: number
  hasOwnTests: boolean
  ownTestsPass: boolean
  hasInstallScripts: boolean
  composite: number
  badges: string[]
}

function installPlugin(
  pluginName: string,
  pluginVersion: string,
  workDir: string
): { success: boolean; error?: string; hasInstallScripts: boolean } {
  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'test-env', private: true }))

  let hasInstallScripts = false
  try {
    execSync(
      `npm install ${pluginName}@${pluginVersion} --ignore-scripts 2>&1`,
      { cwd: workDir, timeout: 120_000, stdio: 'pipe' }
    )

    const pkgPath = path.join(workDir, 'node_modules', pluginName, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts = pkg.scripts || {}
      hasInstallScripts = !!(scripts.preinstall || scripts.postinstall || scripts.prepare)
    }

    return { success: true, hasInstallScripts }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg.slice(0, 500), hasInstallScripts }
  }
}

function runAudit(workDir: string): { critical: number; high: number; moderate: number } {
  try {
    const output = execSync('npm audit --json 2>/dev/null', {
      cwd: workDir,
      timeout: 30_000,
      stdio: 'pipe'
    }).toString()
    const data = JSON.parse(output)
    const v = data.metadata?.vulnerabilities || {}
    return {
      critical: v.critical || 0,
      high: v.high || 0,
      moderate: v.moderate || 0
    }
  } catch {
    return { critical: 0, high: 0, moderate: 0 }
  }
}

function checkOwnTests(pluginDir: string): { hasTests: boolean; pass: boolean } {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8'))
    const testScript = pkg.scripts?.test
    if (!testScript || testScript.includes('echo') || testScript === 'exit 0') {
      return { hasTests: false, pass: false }
    }

    try {
      execSync('npm test 2>&1', { cwd: pluginDir, timeout: 60_000, stdio: 'pipe' })
      return { hasTests: true, pass: true }
    } catch {
      return { hasTests: true, pass: false }
    }
  } catch {
    return { hasTests: false, pass: false }
  }
}

export async function runPluginTest(
  pluginName: string,
  pluginVersion: string
): Promise<RunResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-registry-'))

  console.log(`[runner] Installing ${pluginName}@${pluginVersion}...`)
  const install = installPlugin(pluginName, pluginVersion, workDir)

  if (!install.success) {
    console.log(`[runner] Install failed: ${install.error}`)
    const score = computeScore({
      installs: false, loads: false, activates: false,
      detectedProviders: [], hasSchema: false,
      hasOwnTests: false, ownTestsPass: false,
      auditCritical: 0, auditHigh: 0, auditModerate: 0,
      hasInstallScripts: false
    })

    fs.rmSync(workDir, { recursive: true, force: true })

    return {
      detection: {
        pluginId: pluginName, pluginName, providers: [],
        putHandlers: [], httpRoutes: [], unstubbedAccesses: [],
        loads: false, loadError: install.error,
        activates: false, statusMessages: [], errorMessages: [],
        hasSchema: false
      },
      installs: false,
      installError: install.error,
      auditCritical: 0, auditHigh: 0, auditModerate: 0,
      hasOwnTests: false, ownTestsPass: false,
      hasInstallScripts: false,
      ...score
    }
  }

  console.log(`[runner] Running audit...`)
  const audit = runAudit(workDir)

  const pluginDir = path.join(workDir, 'node_modules', pluginName)
  console.log(`[runner] Detecting providers...`)
  const detection = await detectProviders(pluginDir)

  console.log(`[runner] Checking own tests...`)
  const ownTests = checkOwnTests(pluginDir)

  const testResults: TestResults = {
    installs: true,
    loads: detection.loads,
    activates: detection.activates,
    detectedProviders: detection.providers,
    hasSchema: detection.hasSchema,
    hasOwnTests: ownTests.hasTests,
    ownTestsPass: ownTests.pass,
    auditCritical: audit.critical,
    auditHigh: audit.high,
    auditModerate: audit.moderate,
    hasInstallScripts: install.hasInstallScripts
  }

  const { composite, badges } = computeScore(testResults)

  fs.rmSync(workDir, { recursive: true, force: true })

  return {
    detection,
    installs: true,
    auditCritical: audit.critical,
    auditHigh: audit.high,
    auditModerate: audit.moderate,
    hasOwnTests: ownTests.hasTests,
    ownTestsPass: ownTests.pass,
    hasInstallScripts: install.hasInstallScripts,
    composite,
    badges
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const pluginName = args[0]
  const pluginVersion = args[1] || 'latest'

  if (!pluginName) {
    console.error('Usage: ts-node runner.ts <plugin-name> [version]')
    process.exit(1)
  }

  runPluginTest(pluginName, pluginVersion)
    .then((result) => {
      console.log('\n=== Results ===')
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
