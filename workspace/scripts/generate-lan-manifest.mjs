import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const ADDIN_TITLE_MARKER = 'Word GPT Plus'
const DEFAULT_OUTPUTS = ['release/self-hosted/manifest.lan.xml', 'release/self-hosted/manifest.xml']

function parseArgs(argv) {
  const options = {
    host: process.env.LAN_HOST || '',
    port: process.env.LAN_PORT || process.env.ADDIN_PORT || '',
    template: 'release/self-hosted/manifest.lan.template.xml',
    output: '',
  }

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue
    }

    const eqIdx = arg.indexOf('=')
    if (eqIdx === -1) {
      continue
    }

    const key = arg.slice(2, eqIdx)
    const value = arg.slice(eqIdx + 1).trim()

    if (!value) {
      continue
    }

    if (key === 'host') {
      options.host = value
    } else if (key === 'port') {
      options.port = value
    } else if (key === 'template') {
      options.template = value
    } else if (key === 'output') {
      options.output = value
    }
  }

  return options
}

function getPreferPrivateIp() {
  const ifaces = networkInterfaces()
  const privateCandidates = []
  const publicCandidates = []

  Object.values(ifaces).forEach(ifaceList => {
    if (!ifaceList) return

    for (const iface of ifaceList) {
      if (iface.family !== 'IPv4' || iface.internal) continue

      const ip = iface.address
      if (!ip) continue

      const isPrivate =
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^(172\.(1[6-9]|2\d|3[01]))\./.test(ip)

      if (isPrivate) {
        privateCandidates.push(ip)
      } else {
        publicCandidates.push(ip)
      }
    }
  })

  return privateCandidates[0] || publicCandidates[0] || 'localhost'
}

async function probeAddinPort(host, port) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)

  try {
    const response = await fetch(`http://${host}:${port}/index.html`, {
      signal: controller.signal,
    })
    if (!response.ok) return false

    const html = await response.text()
    return html.includes(ADDIN_TITLE_MARKER)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function detectAddinPort(host, explicitPort) {
  if (explicitPort) {
    return Number(explicitPort)
  }

  const candidates = [3000, 3232]
  for (const port of candidates) {
    if (await probeAddinPort(host, port)) {
      return port
    }
  }

  console.warn(`Could not detect Word GPT Plus on ${host}; defaulting add-in port to 3000`)
  return 3000
}

function renderManifest(templatePath, host, port) {
  if (!existsSync(templatePath)) {
    throw new Error(`Manifest template not found: ${templatePath}`)
  }

  const sourceXml = readFileSync(templatePath, 'utf8')
  return sourceXml.replaceAll('{{LAN_HOST}}', host).replaceAll('{{LAN_PORT}}', String(port)).trim()
}

const options = parseArgs(process.argv.slice(2))
const host = options.host || getPreferPrivateIp()
const templatePath = resolve(process.cwd(), options.template)
const port = await detectAddinPort(host, options.port)
const rendered = renderManifest(templatePath, host, port)
const outputPaths = (options.output ? [options.output] : DEFAULT_OUTPUTS).map(path => resolve(process.cwd(), path))

for (const outputPath of outputPaths) {
  writeFileSync(outputPath, `${rendered}\n`)
  console.log(`Generated LAN manifest: ${outputPath}`)
}

console.log(`LAN host: ${host}`)
console.log(`Add-in UI port: ${port}`)
console.log('Tool/API proxy port: 3100 (configure in add-in Settings, not in manifest URLs)')
