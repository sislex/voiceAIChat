// Блок «Контекст проекта» для промпта модели.
//
// Живёт отдельно, потому что его строят два места: ход модели (`turns.ts`) и
// панель «что ушло модели» (`routes/rest.ts`). Пока это были две копии, они
// разъезжались — панель показывала контекст без типа проекта, хотя модель его
// уже получала, то есть врала пользователю.
import type { ProjectSummary } from '@voicechat/shared'

/** Список включённых подсистем проекта: «git, ci, qa» или «нет». */
export function describeProjectFeatures(features: Record<string, boolean>): string {
  const enabled = Object.entries(features).filter(([, on]) => on).map(([name]) => name)
  return enabled.length ? enabled.join(', ') : 'нет (только доска и задачи)'
}

/**
 * Строки контекста проекта. Тип и его возможности идут первыми после id: без них
 * модель предлагает запускать CI и собирать релизы там, где они выключены.
 */
export function projectPromptLines(project: ProjectSummary): string[] {
  return [
    `ID проекта: ${project.id}`,
    project.typeChain?.label ? `Тип проекта: ${project.typeChain.label}` : '',
    project.typeChain ? `Доступные подсистемы: ${describeProjectFeatures(project.typeChain.features)}` : '',
    project.gitUrl ? `Git-репозиторий: ${project.gitUrl}` : '',
    project.technologies.length ? `Технологии: ${project.technologies.join(', ')}` : '',
    project.skills.length ? `Навыки/области: ${project.skills.join(', ')}` : '',
    project.description ? project.description : ''
  ].filter(Boolean)
}

/** Заголовок блока — общий у хода модели и у панели «что ушло модели». */
export function projectPromptBlock(project: ProjectSummary): string {
  return `## Контекст проекта «${project.name}»\n${projectPromptLines(project).join('\n')}`
}
