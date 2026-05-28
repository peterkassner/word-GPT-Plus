import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

export const MANIFEST_ID_PATTERN = /<Id>([0-9a-fA-F-]{36})<\/Id>/

/** @param {string} xml */
export function readManifestId(xml) {
  const match = xml.match(MANIFEST_ID_PATTERN)
  return match ? match[1].toLowerCase() : null
}

/** @param {string} xml @param {string} [newId] */
export function replaceManifestId(xml, newId = randomUUID()) {
  if (!MANIFEST_ID_PATTERN.test(xml)) {
    throw new Error('Manifest is missing a valid <Id>GUID</Id> element')
  }

  return xml.replace(MANIFEST_ID_PATTERN, `<Id>${newId.toLowerCase()}</Id>`)
}

/** @param {string} manifestPath @param {{ newId?: string, dryRun?: boolean }} [options] */
export function bumpManifestFile(manifestPath, options = {}) {
  const absolutePath = resolve(process.cwd(), manifestPath)

  if (!existsSync(absolutePath)) {
    throw new Error(`Manifest not found: ${absolutePath}`)
  }

  const resolvedPath = realpathSync(absolutePath)
  const previousXml = readFileSync(resolvedPath, 'utf8')
  const previousId = readManifestId(previousXml)
  const nextId = (options.newId || randomUUID()).toLowerCase()
  const nextXml = replaceManifestId(previousXml, nextId)

  if (!options.dryRun && nextXml !== previousXml) {
    writeFileSync(resolvedPath, nextXml.endsWith('\n') ? nextXml : `${nextXml}\n`)
  }

  return {
    path: resolvedPath,
    previousId,
    nextId,
    changed: previousId !== nextId,
  }
}

/** @param {string[]} manifestPaths @param {{ newId?: string, dryRun?: boolean }} [options] */
export function bumpManifestFiles(manifestPaths, options = {}) {
  const sharedId = (options.newId || randomUUID()).toLowerCase()
  const results = []

  for (const manifestPath of manifestPaths) {
    results.push(bumpManifestFile(manifestPath, { ...options, newId: sharedId }))
  }

  return { id: sharedId, results }
}
