export interface TestResults {
  installs: boolean
  loads: boolean
  activates: boolean
  detectedProviders: string[]
  hasSchema: boolean
  hasOwnTests: boolean
  ownTestsPass: boolean
  auditCritical: number
  auditHigh: number
  auditModerate: number
  hasInstallScripts: boolean
}

export type Badge =
  | 'compatible'
  | 'loads'
  | 'activates'
  | 'has-providers'
  | 'tested'
  | 'secure'
  | 'broken'

export function computeScore(r: TestResults): {
  composite: number
  badges: Badge[]
} {
  if (!r.installs) return { composite: 0, badges: ['broken'] }

  let score = 0
  const badges: Badge[] = []

  // Install: 15 points
  score += 15
  badges.push('compatible')

  // Loads (constructor succeeds): 15 points
  if (r.loads) {
    score += 15
    badges.push('loads')
  }

  // Activates (start() completes without error): 15 points
  if (r.activates) {
    score += 15
    badges.push('activates')
  }

  // Provider registration: 10 points
  if (r.detectedProviders.length > 0) {
    score += 10
    badges.push('has-providers')
  }

  // Has JSON schema: 5 points
  if (r.hasSchema) {
    score += 5
  }

  // Own tests: 20 points
  if (r.hasOwnTests && r.ownTestsPass) {
    score += 20
    badges.push('tested')
  } else if (r.hasOwnTests) {
    score += 5
  }

  // Security: 20 points
  if (r.auditCritical === 0 && r.auditHigh === 0) {
    score += 20
    badges.push('secure')
  } else if (r.auditCritical === 0) {
    score += 10
  }

  return {
    composite: Math.max(0, Math.min(100, score)),
    badges
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : ''
  }

  const results: TestResults = {
    installs: get('--installs') === 'true',
    loads: get('--loads') === 'true',
    activates: get('--activates') === 'true',
    detectedProviders: JSON.parse(get('--providers') || '[]'),
    hasSchema: get('--has-schema') === 'true',
    hasOwnTests: get('--has-own-tests') === 'true',
    ownTestsPass: get('--own-tests-pass') === 'true',
    auditCritical: parseInt(get('--audit-critical') || '0', 10),
    auditHigh: parseInt(get('--audit-high') || '0', 10),
    auditModerate: parseInt(get('--audit-moderate') || '0', 10),
    hasInstallScripts: get('--has-install-scripts') === 'true'
  }

  const { composite, badges } = computeScore(results)
  const output = `json=${JSON.stringify({ composite, badges })}\nbadges=${badges.join(',')}`

  if (process.env.GITHUB_OUTPUT) {
    const fs = require('fs')
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n')
  } else {
    console.log(`Score: ${composite}/100`)
    console.log(`Badges: ${badges.join(', ')}`)
  }
}
