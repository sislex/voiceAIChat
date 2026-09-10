// Make metrics in Prometheus format (roadmap-2, item 17): textual exposition of AdminMakeStats.
// This is a pure function; directory traversal and data collection remain in
// MakeWorkspaces.adminStats.
import type { AdminMakeStats } from '@voicechat/shared'

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

export function formatMakeMetrics(stats: AdminMakeStats): string {
  const lines: string[] = []
  const gauge = (name: string, help: string, value: number, labels?: Record<string, string>): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
    const l = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''
    lines.push(`${name}${l} ${value}`)
  }
  if (stats.disk) { gauge('make_disk_free_bytes', 'Free bytes on the Make data volume', stats.disk.freeBytes); gauge('make_disk_total_bytes', 'Total bytes on the Make data volume', stats.disk.totalBytes); gauge('make_disk_alert', 'Free space is below the alert threshold (1 means yes)', stats.disk.alert ? 1 : 0) }
  gauge('voicechat_make_projects', 'Number of Make projects', stats.projects)
  gauge('voicechat_make_bytes_total', 'Total project bytes including files, snapshots, and story PNGs', stats.bytes)
  gauge('voicechat_make_files_bytes', 'Bytes in project files', stats.filesBytes)
  gauge('voicechat_make_snapshots_bytes', 'Bytes in snapshots', stats.snapshotsBytes)
  gauge('voicechat_make_shots_bytes', 'Bytes in story PNG snapshots', stats.shotsBytes)
  gauge('voicechat_make_published', 'Published projects', stats.published)
  gauge('voicechat_make_shared', 'Projects with read-only links', stats.shared)
  gauge('voicechat_make_publication_views_total', 'Total publication views', stats.views)
  gauge('voicechat_make_project_limit_bytes', 'Per-project quota', stats.limitBytes)
  gauge('voicechat_make_user_limit_bytes', 'Per-user quota', stats.userLimitBytes)
  lines.push('# HELP voicechat_make_user_bytes Bytes used per user', '# TYPE voicechat_make_user_bytes gauge')
  for (const u of stats.byUser) lines.push(`voicechat_make_user_bytes{user="${esc(u.user)}"} ${u.bytes}`)
  lines.push('# HELP voicechat_make_user_projects Projects per user', '# TYPE voicechat_make_user_projects gauge')
  for (const u of stats.byUser) lines.push(`voicechat_make_user_projects{user="${esc(u.user)}"} ${u.projects}`)
  return lines.join('\n') + '\n'
}
