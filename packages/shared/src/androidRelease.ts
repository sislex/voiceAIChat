/** Immutable owner pin. Public responses replace url with Core's download path. */
export interface AndroidRelease {
  url: string
  filename: string
  sha256: string
  size: number
  commit: string
  minSdk: number
  abis: string[]
  versionName: string
  versionCode: number
}
export interface AndroidReleaseManifest {
  schemaVersion: 1
  android: AndroidRelease
}
export function parseAndroidReleaseManifest(value: unknown): AndroidReleaseManifest {
  const m = value as AndroidReleaseManifest | null
  const a = m?.android
  if (m?.schemaVersion !== 1 || !a ||
      typeof a.url !== 'string' || !a.url ||
      typeof a.filename !== 'string' || !/^[a-zA-Z0-9._-]+\.apk$/.test(a.filename) ||
      typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) ||
      typeof a.commit !== 'string' || !/^[a-f0-9]{40}$/.test(a.commit) ||
      !Number.isSafeInteger(a.size) || a.size <= 0 ||
      !Number.isSafeInteger(a.minSdk) || a.minSdk < 1 ||
      !Number.isSafeInteger(a.versionCode) || a.versionCode < 1 ||
      typeof a.versionName !== 'string' || !a.versionName ||
      !Array.isArray(a.abis) || !a.abis.length || a.abis.some(abi => typeof abi !== 'string' || !abi)) {
    throw new Error('Invalid Android release manifest')
  }
  return { schemaVersion: 1, android: {
    url: a.url, filename: a.filename, sha256: a.sha256, size: a.size,
    commit: a.commit, minSdk: a.minSdk, abis: [...a.abis],
    versionName: a.versionName, versionCode: a.versionCode
  } }
}
