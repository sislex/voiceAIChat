import { describe, expect, it } from 'vitest'
import { deployConfigFiles } from './makeDeploy'

describe('deployConfigFiles', () => {
  it.each(['netlify', 'vercel'] as const)('%s generates English deployment instructions in every export mode', (target) => {
    for (const vite of [false, true]) {
      for (const hasMocks of [false, true]) {
        const instructions = deployConfigFiles(target, { vite, hasMocks })['DEPLOY.md']!
        expect(instructions).toContain('Configuration:')
        expect(instructions).not.toMatch(/[\u0400-\u04ff]/u)
        expect(instructions.includes('API mocks')).toBe(hasMocks)
      }
    }
  })
  it('Netlify publishes the static root or Vite dist with SPA redirects', () => {
    expect(deployConfigFiles('netlify', { vite: false, hasMocks: false })['netlify.toml']).toContain('publish = "."')
    const vite = deployConfigFiles('netlify', { vite: true, hasMocks: true })
    expect(vite['netlify.toml']).toContain('publish = "dist"')
    expect(vite['DEPLOY.md']).toContain('API mocks')
  })
  it('Vercel emits valid JSON with the expected output directory', () => {
    expect(JSON.parse(deployConfigFiles('vercel', { vite: true, hasMocks: false })['vercel.json']!)).toMatchObject({ buildCommand: 'npm run build', outputDirectory: 'dist' })
    expect(JSON.parse(deployConfigFiles('vercel', { vite: false, hasMocks: false })['vercel.json']!)).toMatchObject({ outputDirectory: '.' })
  })
})
