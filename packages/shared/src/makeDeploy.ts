// Hosting export (roadmap-4, item 36): add Netlify/Vercel configuration to project ZIPs.
// Static exports publish the root; Vite exports build into dist. Generated English
// documentation explains that project API mocks need a real backend on static hosting.

export type MakeDeployTarget = 'netlify' | 'vercel'
export const MAKE_DEPLOY_TARGETS: ReadonlyArray<{ id: MakeDeployTarget; title: string }> = [
  { id: 'netlify', title: 'Netlify' },
  { id: 'vercel', title: 'Vercel' }
]

export function deployConfigFiles(target: MakeDeployTarget, options: { vite: boolean; hasMocks: boolean }): Record<string, string> {
  const note = options.hasMocks
    ? '\n\n> This project contains `mock/**` API mocks, which do not run on static hosting. Replace `fetch("api/…")` calls with a real backend or serverless functions.'
    : ''
  if (target === 'netlify') {
    const toml = options.vite
      ? '[build]\n  command = "npm run build"\n  publish = "dist"\n\n[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n'
      : '[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n'
    return { 'netlify.toml': toml, 'DEPLOY.md': `# Netlify\n\n1. \`npm i -g netlify-cli\` (or connect the repository in the Netlify dashboard).\n2. \`netlify deploy --prod${options.vite ? '' : ' --dir=.'}\`.\n\nConfiguration: \`netlify.toml\`${options.vite ? ' (Vite build, publishing `dist`)' : ' (publish the root directory as-is)'}.${note}\n` }
  }
  const vercel = options.vite
    ? { $schema: 'https://openapi.vercel.sh/vercel.json', buildCommand: 'npm run build', outputDirectory: 'dist', rewrites: [{ source: '/(.*)', destination: '/index.html' }] }
    : { $schema: 'https://openapi.vercel.sh/vercel.json', outputDirectory: '.', cleanUrls: true }
  return { 'vercel.json': JSON.stringify(vercel, null, 2) + '\n', 'DEPLOY.md': `# Vercel\n\n1. \`npm i -g vercel\` (or import the repository at vercel.com).\n2. \`vercel --prod\`.\n\nConfiguration: \`vercel.json\`${options.vite ? ' (Vite build, output in `dist`)' : ' (static files from the root)'}.${note}\n` }
}
