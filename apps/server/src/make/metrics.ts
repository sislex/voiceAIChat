// Метрики Make в формате Prometheus (roadmap-2 п.17): текстовая экспозиция поверх AdminMakeStats.
// Чистая функция — сбор данных (обход каталогов) остаётся в MakeWorkspaces.adminStats.
import type { AdminMakeStats } from '@voicechat/shared'

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

export function formatMakeMetrics(stats: AdminMakeStats): string {
  const lines: string[] = []
  const gauge = (name: string, help: string, value: number, labels?: Record<string, string>): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
    const l = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''
    lines.push(`${name}${l} ${value}`)
  }
  gauge('voicechat_make_projects', 'Число проектов Make', stats.projects)
  gauge('voicechat_make_bytes_total', 'Занято байт всеми проектами (файлы + снимки + PNG стори)', stats.bytes)
  gauge('voicechat_make_files_bytes', 'Байт в файлах проектов', stats.filesBytes)
  gauge('voicechat_make_snapshots_bytes', 'Байт в снимках', stats.snapshotsBytes)
  gauge('voicechat_make_shots_bytes', 'Байт в PNG-снимках стори', stats.shotsBytes)
  gauge('voicechat_make_published', 'Опубликованных проектов', stats.published)
  gauge('voicechat_make_shared', 'Проектов с read-only ссылкой', stats.shared)
  gauge('voicechat_make_publication_views_total', 'Просмотров публикаций (сумма)', stats.views)
  gauge('voicechat_make_project_limit_bytes', 'Квота на проект', stats.limitBytes)
  gauge('voicechat_make_user_limit_bytes', 'Квота на пользователя', stats.userLimitBytes)
  lines.push('# HELP voicechat_make_user_bytes Занято байт по пользователям', '# TYPE voicechat_make_user_bytes gauge')
  for (const u of stats.byUser) lines.push(`voicechat_make_user_bytes{user="${esc(u.user)}"} ${u.bytes}`)
  lines.push('# HELP voicechat_make_user_projects Проектов по пользователям', '# TYPE voicechat_make_user_projects gauge')
  for (const u of stats.byUser) lines.push(`voicechat_make_user_projects{user="${esc(u.user)}"} ${u.projects}`)
  return lines.join('\n') + '\n'
}
