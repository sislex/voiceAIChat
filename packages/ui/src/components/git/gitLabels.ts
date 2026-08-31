// Подписи панели кода — одно место на панель, диалоги и сториз: иначе «конфликт» в
// списке файлов и «конфликт» в баннере разъедутся по формулировкам.
import { gitChangeLabel, gitChangeShort, gitProblemMessage, type GitChangeState, type GitWorkspaceProblem, type GitWorkspaceRef } from '@shared/gitWorkspace'

export { gitChangeLabel, gitChangeShort, gitProblemMessage }

/** Что делать дальше при этой проблеме: текст ведёт к действию, а не констатирует. */
export function gitProblemHint(problem: GitWorkspaceProblem): string {
  switch (problem) {
    case 'workspace_not_found': return 'Выберите другую рабочую копию — эта могла быть удалена вместе с задачей.'
    case 'machine_missing': return 'Машина не привязана к проекту или у вас нет к ней доступа. Проверьте настройки проекта.'
    case 'machine_offline': return 'Включите машину или выберите копию на другой машине — состояние читается прямо с неё.'
    case 'path_missing': return 'Задайте каталог проекта на машине в настройках проекта.'
    case 'not_a_repository': return 'В этом каталоге нет git. Запустите ран задачи — он клонирует репозиторий.'
    case 'workspace_released': return 'Каталог освободил cleanup-шаг рана. Запустите ран задачи заново.'
    case 'workspace_busy': return 'Дождитесь окончания рана: смотреть файлы можно, менять — нет.'
  }
}

/** Подпись рабочей копии для селектора: задача, ветка и машина. */
export function gitWorkspaceLabel(ref: GitWorkspaceRef): string {
  const kind = ref.kind === 'merge-clone'
    ? 'merge-клон'
    : ref.kind === 'chat-workspace'
      ? 'чат'
      : ref.kind === 'project-worktree'
        ? 'папка проекта'
        : ref.taskSeq !== null ? `задача #${ref.taskSeq}` : 'задача'
  const title = ref.taskTitle ? ` · ${ref.taskTitle}` : ''
  const branch = ref.expectedBranch ? ` · ${ref.expectedBranch}` : ''
  const machine = ref.machineName ? ` · ${ref.machineName}` : ''
  return `${kind}${title}${branch}${machine}`
}

/** Порядок файлов в списке: сначала конфликты, потом правки, в конце новые. */
const CHANGE_ORDER: Record<GitChangeState, number> = {
  conflict: 0, modified: 1, renamed: 2, typechange: 3, deleted: 4, added: 5, untracked: 6
}

export function gitChangeOrder(state: GitChangeState): number {
  return CHANGE_ORDER[state]
}
