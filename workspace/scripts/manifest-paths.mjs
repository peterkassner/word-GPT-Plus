import { resolve } from 'node:path'

/** Repo-root-relative paths (for git show / diff / CI). */
export const CANONICAL_MANIFEST_GIT = 'references/gg-laptop-docx-runtime-apps/manifest.xml'
export const MANIFEST_STAMP_GIT = 'references/gg-laptop-docx-runtime-apps/.office-addin-id'

/** Paths relative to `workspace/` when scripts run from that directory. */
export const CANONICAL_MANIFEST = `../${CANONICAL_MANIFEST_GIT}`
export const MANIFEST_STAMP = `../${MANIFEST_STAMP_GIT}`

/** Propagate the same Id to the Windows catalog symlink and tracked LAN copy. */
export const SYNC_MANIFESTS = ['release/self-hosted/manifest.xml', 'release/self-hosted/manifest.lan.xml']

export const DEFAULT_MANIFESTS = [CANONICAL_MANIFEST, ...SYNC_MANIFESTS]

export function resolveFromWorkspace(relativePath) {
  return resolve(process.cwd(), relativePath)
}
