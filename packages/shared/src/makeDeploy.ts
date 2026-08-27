// Экспорт для хостингов (roadmap-4 п.36): конфиги Netlify и Vercel к ZIP-архиву проекта.
// Статика: корень как publish-директория; Vite-проект: сборка `npm run build` в `dist`. Моки на хостинге не работают —
// напоминаем об этом в README-фрагменте, чтобы fetch("api/…") не стал сюрпризом после деплоя.

export type MakeDeployTarget = 'netlify' | 'vercel'
export const MAKE_DEPLOY_TARGETS: ReadonlyArray<{ id: MakeDeployTarget; title: string }> = [
  { id: 'netlify', title: 'Netlify' },
  { id: 'vercel', title: 'Vercel' }
]

export function deployConfigFiles(target: MakeDeployTarget, options: { vite: boolean; hasMocks: boolean }): Record<string, string> {
  const note = options.hasMocks
    ? '\n\n> В проекте есть моки `mock/**` — на хостинге они не отвечают. Замените `fetch("api/…")` на настоящий бэкенд или serverless-функции.'
    : ''
  if (target === 'netlify') {
    const toml = options.vite
      ? '[build]\n  command = "npm run build"\n  publish = "dist"\n\n[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n'
      : '[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n'
    return { 'netlify.toml': toml, 'DEPLOY.md': `# Netlify\n\n1. \`npm i -g netlify-cli\` (или подключите репозиторий в панели Netlify).\n2. \`netlify deploy --prod${options.vite ? '' : ' --dir=.'}\`.\n\nКонфиг — \`netlify.toml\`${options.vite ? ' (сборка Vite, публикуется `dist`)' : ' (публикуется корень как есть)'}.${note}\n` }
  }
  const vercel = options.vite
    ? { $schema: 'https://openapi.vercel.sh/vercel.json', buildCommand: 'npm run build', outputDirectory: 'dist', rewrites: [{ source: '/(.*)', destination: '/index.html' }] }
    : { $schema: 'https://openapi.vercel.sh/vercel.json', outputDirectory: '.', cleanUrls: true }
  return { 'vercel.json': JSON.stringify(vercel, null, 2) + '\n', 'DEPLOY.md': `# Vercel\n\n1. \`npm i -g vercel\` (или импортируйте репозиторий на vercel.com).\n2. \`vercel --prod\`.\n\nКонфиг — \`vercel.json\`${options.vite ? ' (сборка Vite, вывод `dist`)' : ' (статика из корня)'}.${note}\n` }
}
