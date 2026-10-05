import { isDevBuildVersion } from '../packages/shared/src/devStand.ts'

/** Release metadata can carry versions in packages, tools and renderer provenance. */
export function assertReleaseVersions(value, context = 'Release') {
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'version' || key === 'devBuildId') && isDevBuildVersion(entry))
      throw Error(`${context}: development build ${entry} cannot be released or pinned`)
    if (entry && typeof entry === 'object') assertReleaseVersions(entry, `${context}.${key}`)
  }
}
