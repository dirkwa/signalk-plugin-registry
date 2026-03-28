import * as fs from 'fs'

async function resolveStable(): Promise<string> {
  const res = await fetch('https://registry.npmjs.org/signalk-server/latest')
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
  const data = await res.json()
  return data.version
}

async function resolveMaster(): Promise<string> {
  const res = await fetch(
    'https://api.github.com/repos/SignalK/signalk-server/commits/master',
    { headers: { Accept: 'application/vnd.github.sha' } }
  )
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
  const sha = await res.text()
  return sha.trim().slice(0, 7)
}

async function main() {
  const stableVersion = await resolveStable()
  const masterSha = await resolveMaster()

  const output = [
    `stable_version=${stableVersion}`,
    `master_sha=${masterSha}`
  ].join('\n')

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n')
  } else {
    console.log(`stable_version=${stableVersion}`)
    console.log(`master_sha=${masterSha}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
