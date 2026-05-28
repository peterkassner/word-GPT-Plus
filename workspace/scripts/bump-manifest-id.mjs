import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { bumpManifestFiles, readManifestId } from './manifest-id.mjs'
import {
  CANONICAL_MANIFEST,
  CANONICAL_MANIFEST_GIT,
  DEFAULT_MANIFESTS,
  MANIFEST_STAMP,
  MANIFEST_STAMP_GIT,
  resolveFromWorkspace,
} from './manifest-paths.mjs'

const CODE_CHANGE_PREFIXES = [
  'workspace/src/',
  'workspace/proxy-server/',
  'workspace/public/',
  'workspace/package.json',
  'workspace/vite.config',
  'workspace/Dockerfile',
  'workspace/docker-compose',
  'src/',
  'proxy-server/',
  'public/',
  'package.json',
  'vite.config',
  'Dockerfile',
  'docker-compose',
]

function gitPath(relativePath) {
  if (relativePath.startsWith('references/') || relativePath.startsWith('workspace/')) {
    return relativePath
  }

  if (relativePath.startsWith('../references/')) {
    return relativePath.slice(3)
  }

  if (relativePath.startsWith('../workspace/')) {
    return relativePath.slice(3)
  }

  const cwd = process.cwd()
  if (cwd.endsWith('/workspace') || cwd.endsWith('\\workspace')) {
    return relativePath.startsWith('release/') ? `workspace/${relativePath}` : `references/${relativePath}`
  }

  return relativePath
}

function parseArgs(argv) {
  const options = {
    check: false,
    dryRun: false,
    baseRef: process.env.MANIFEST_ID_BASE_REF || 'HEAD~1',
    manifests: [...DEFAULT_MANIFESTS],
  }

  for (const arg of argv) {
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--base-ref=')) {
      options.baseRef = arg.slice('--base-ref='.length)
    } else if (arg.startsWith('--manifest=')) {
      options.manifests = [arg.slice('--manifest='.length)]
    }
  }

  return options
}

function listChangedFiles(baseRef) {
  try {
    const output = execSync(`git diff --name-only ${baseRef} HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function requiresManifestIdBump(changedFiles) {
  return changedFiles.some(file => CODE_CHANGE_PREFIXES.some(prefix => file.startsWith(prefix)))
}

function readStampId() {
  const stampPath = resolveFromWorkspace(MANIFEST_STAMP)
  if (!existsSync(stampPath)) {
    return null
  }

  const [id] = readFileSync(stampPath, 'utf8').trim().split(/\s+/)
  return id?.toLowerCase() || null
}

function writeStamp(id) {
  const stampPath = resolveFromWorkspace(MANIFEST_STAMP)
  writeFileSync(stampPath, `${id.toLowerCase()} ${new Date().toISOString()}\n`)
}

function readCanonicalManifestId() {
  const absolutePath = resolveFromWorkspace(CANONICAL_MANIFEST)
  if (!existsSync(absolutePath)) {
    return null
  }

  return readManifestId(readFileSync(absolutePath, 'utf8'))
}

function runCheck(options) {
  const changedFiles = listChangedFiles(options.baseRef)

  if (!requiresManifestIdBump(changedFiles)) {
    console.log('Manifest GUID check skipped: no add-in code changes since', options.baseRef)
    return
  }

  const previousStampId = (() => {
    try {
      const stampAtBase = execSync(`git show ${options.baseRef}:${gitPath(MANIFEST_STAMP_GIT)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return stampAtBase.trim().split(/\s+/)[0]?.toLowerCase() || null
    } catch {
      return null
    }
  })()

  const previousCanonicalId = (() => {
    try {
      const manifestAtBase = execSync(`git show ${options.baseRef}:${gitPath(CANONICAL_MANIFEST_GIT)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return readManifestId(manifestAtBase)
    } catch {
      return null
    }
  })()

  const currentStampId = readStampId()
  const currentCanonicalId = readCanonicalManifestId()
  const stampChanged = Boolean(previousStampId && currentStampId && previousStampId !== currentStampId)
  const canonicalChanged = Boolean(
    previousCanonicalId && currentCanonicalId && previousCanonicalId !== currentCanonicalId,
  )

  if (stampChanged || canonicalChanged) {
    console.log('Manifest GUID check passed.')
    if (stampChanged) {
      console.log(`  stamp: ${previousStampId} -> ${currentStampId}`)
    }
    if (canonicalChanged) {
      console.log(`  ${CANONICAL_MANIFEST_GIT}: ${previousCanonicalId} -> ${currentCanonicalId}`)
    }
    return
  }

  console.error('Manifest GUID check failed.')
  console.error(`Add-in files changed since ${options.baseRef}, but Office add-in Id did not change.`)
  console.error('Run: yarn bump:manifest:id')
  console.error(`Then commit ${MANIFEST_STAMP_GIT} and ${CANONICAL_MANIFEST_GIT} (and re-sideload in Word).`)
  process.exit(1)
}

function runBump(options) {
  const existingManifests = options.manifests.filter(path => existsSync(resolve(process.cwd(), path)))

  if (existingManifests.length === 0) {
    throw new Error(`No manifest files found. Expected one of: ${options.manifests.join(', ')}`)
  }

  const { id, results } = bumpManifestFiles(existingManifests, { dryRun: options.dryRun })

  if (!options.dryRun) {
    writeStamp(id)
  }

  for (const result of results) {
    const status = result.changed ? 'updated' : 'unchanged'
    console.log(`Manifest Id ${status}: ${result.path}`)
    if (result.previousId) {
      console.log(`  ${result.previousId} -> ${result.nextId}`)
    } else {
      console.log(`  -> ${result.nextId}`)
    }
  }

  if (!options.dryRun) {
    console.log(`Stamp written: ${resolveFromWorkspace(MANIFEST_STAMP)}`)
  }
}

const options = parseArgs(process.argv.slice(2))

if (options.check) {
  runCheck(options)
} else {
  runBump(options)
}
