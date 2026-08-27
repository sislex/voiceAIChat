import { describe, expect, it } from 'vitest'
import { deployConfigFiles } from './makeDeploy'

describe('deployConfigFiles', () => {
  it('Netlify: статика публикует корень, Vite — dist с SPA-редиректом', () => {
    expect(deployConfigFiles('netlify', { vite: false, hasMocks: false })['netlify.toml']).toContain('publish = "."')
    const vite = deployConfigFiles('netlify', { vite: true, hasMocks: true })
    expect(vite['netlify.toml']).toContain('publish = "dist"')
    expect(vite['DEPLOY.md']).toContain('моки')
  })
  it('Vercel: vercel.json валидный JSON с нужным outputDirectory', () => {
    expect(JSON.parse(deployConfigFiles('vercel', { vite: true, hasMocks: false })['vercel.json']!)).toMatchObject({ buildCommand: 'npm run build', outputDirectory: 'dist' })
    expect(JSON.parse(deployConfigFiles('vercel', { vite: false, hasMocks: false })['vercel.json']!)).toMatchObject({ outputDirectory: '.' })
  })
})
