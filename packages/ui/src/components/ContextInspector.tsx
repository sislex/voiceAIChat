import { useEffect, useMemo, useState } from 'react'
import type { AgentInfo } from '@shared/agentProtocol'
import type { KbContextMode, LlmProvider, PermissionMode } from '@shared/types'
import type { ProjectSummary } from '@shared/projects'
import { Button } from '@voicechat/ui-kit'

type ContextStatus = 'Применяется' | 'Доступен' | 'Не выбран' | 'Недоступен' | 'Ограничен' | 'Скрытый текст' | 'Не применимо'
interface ContextItem { id: string; title: string; description: string; type: string; source: string; scope: string; status: ContextStatus; priority: string; details: string; reason: string; limitations: string; technicalName?: string; parameters?: string[]; mutates?: boolean }
interface ContextGroup { id: string; level: number; title: string; description: string; items: ContextItem[] }
export interface ContextInspectorProps { conversationId: string; provider: LlmProvider; model: string; permissionMode: PermissionMode; kbMode: KbContextMode; agent?: AgentInfo; workdir: string | null; project?: ProjectSummary; selectedSkillNames: string[] }

const systemItems: ContextItem[] = [
  { id: 'platform-safety', title: 'Правила безопасности', description: 'Ограничивают опасные действия независимо от пожеланий пользователя.', type: 'Системная инструкция', source: 'Платформа', scope: 'Все ответы и действия', status: 'Скрытый текст', priority: 'Системные правила платформы', details: 'Определяют действия, которые модель не может выполнять даже по просьбе пользователя.', reason: 'Всегда применяются платформой.', limitations: 'Полный текст недоступен, показано безопасное описание.' },
  { id: 'platform-privacy', title: 'Конфиденциальность и секреты', description: 'Запрещает раскрывать токены, авторизацию и закрытые инструкции.', type: 'Системная инструкция', source: 'Платформа', scope: 'Контекст, инструменты и ответы', status: 'Скрытый текст', priority: 'Системные правила платформы', details: 'Секретные значения скрываются, а доступ к источникам повторно проверяется.', reason: 'Всегда применяется платформой.', limitations: 'Полный текст и секретные значения не раскрываются.' }
]
const appItems: ContextItem[] = [
  { id: 'chatai-tools-policy', title: 'Правила работы с инструментами', description: 'Инструменты используются только в пределах разрешений и текущей задачи.', type: 'Инструкция приложения', source: 'ChatAI', scope: 'Текущий разговор', status: 'Применяется', priority: 'Инструкции приложения ChatAI', details: 'ChatAI связывает инструменты с выбранной машиной, проектом и режимом прав.', reason: 'Добавляется приложением к каждому ходу.', limitations: 'Наличие имени инструмента не гарантирует право или техническую доступность.' },
  { id: 'chatai-kb-policy', title: 'Порядок работы с базой знаний', description: 'Определяет автоматическую вставку и самостоятельный поиск модели.', type: 'Инструкция приложения', source: 'ChatAI · политика БЗ', scope: 'Текущий разговор', status: 'Применяется', priority: 'Инструкции приложения ChatAI', details: 'Auto добавляет релевантные фрагменты до запуска; manual оставляет инструменты; off отключает оба механизма.', reason: 'Настройка хранится отдельно для разговора.', limitations: 'Модель видит только доступные владельцу и проекту документы.' }
]
function tool(id: string, title: string, source: string, description: string, status: ContextStatus, mutates: boolean, parameters: string[], limitations: string): ContextItem {
  return { id, title, technicalName: id, description, type: 'MCP-инструмент', source, scope: 'Текущий ход', status, priority: 'Возможности (не уровень инструкций)', details: description, reason: status === 'Доступен' ? 'Подключён текущей конфигурацией разговора.' : 'Не подключён текущей конфигурацией.', limitations, parameters, mutates }
}
function detailIdFromHash(conversationId: string): string | null {
  const prefix = `#/chat/${encodeURIComponent(conversationId)}/context/`
  return window.location.hash.startsWith(prefix) ? decodeURIComponent(window.location.hash.slice(prefix.length).split(/[/?]/)[0] ?? '') : null
}

export function ContextInspector(props: ContextInspectorProps): JSX.Element {
  const [detailId, setDetailId] = useState<string | null>(() => detailIdFromHash(props.conversationId))
  useEffect(() => {
    const sync = (): void => setDetailId(detailIdFromHash(props.conversationId))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [props.conversationId])

  const groups = useMemo<ContextGroup[]>(() => {
    const skills = props.agent?.policy.skills ?? []
    const selected = new Set(props.selectedSkillNames)
    const projectItems: ContextItem[] = [{ id: 'project-agents', title: props.workdir ? 'Инструкции AGENTS.md рабочей директории' : 'Проектные инструкции', description: props.workdir ? 'Иерархия AGENTS.md от корня проекта до текущего каталога.' : 'Рабочая директория не выбрана.', type: 'Проектная инструкция', source: props.workdir ? `${props.workdir}/AGENTS.md и родительские каталоги` : 'AGENTS.md', scope: props.workdir ?? 'Рабочая директория не выбрана', status: props.workdir ? 'Применяется' : 'Не применимо', priority: 'Инструкции проекта и рабочей директории', details: 'Более конкретный AGENTS.md уточняет инструкции родительского каталога в своей области.', reason: props.workdir ? 'Рабочая директория задаёт цепочку применимых файлов.' : 'Без рабочей директории применимость не определена.', limitations: 'Полный текст открывается только после проверки доступа к файлу; инспектор не раскрывает его автоматически.' }]
    const settings: ContextItem[] = [
      { id: 'chat-llm', title: 'Модель и провайдер', description: `${props.provider} · ${props.model || 'модель из конфигурации'}`, type: 'Настройка разговора', source: 'Настройки чата', scope: 'Следующий ход', status: 'Применяется', priority: 'Настройки текущего разговора', details: 'Эффективная пара провайдера и модели для следующего сообщения.', reason: 'Выбрана в разговоре или унаследована.', limitations: 'Доступность дополнительно проверяется сервером.' },
      { id: 'chat-machine', title: 'Машина и рабочая директория', description: props.agent ? `${props.agent.name} · ${props.workdir || 'корень машины'}` : 'Удалённая машина не подключена', type: 'Настройка разговора', source: 'Настройки чата', scope: props.workdir ?? 'Без машины', status: props.agent ? (props.agent.online ? 'Применяется' : 'Недоступен') : 'Не выбран', priority: 'Настройки текущего разговора', details: 'Цель выполнения и каталог хранятся отдельно для разговора.', reason: props.agent ? 'Машина выбрана в настройках.' : 'Машина не выбрана.', limitations: props.agent?.online ? 'Операции ограничены политикой машины и режимом прав.' : 'Для команд нужна доступная машина.' },
      { id: 'chat-permissions', title: 'Режим разрешений', description: props.permissionMode, type: 'Настройка разговора', source: 'Настройки чата', scope: 'Инструменты и изменения', status: props.permissionMode === 'plan' ? 'Ограничен' : 'Применяется', priority: 'Настройки текущего разговора', details: 'Определяет, может ли агент изменять данные.', reason: 'Вычислен из настроек и серверных ограничений.', limitations: props.permissionMode === 'plan' ? 'Только чтение и планирование.' : 'Опасные действия ограничены правилами выше.' },
      { id: 'chat-project', title: 'Привязанный проект', description: props.project?.name ?? 'Проект не выбран', type: 'Настройка разговора', source: 'Настройки чата', scope: props.project?.name ?? 'Без проекта', status: props.project ? 'Применяется' : 'Не выбран', priority: 'Настройки текущего разговора', details: 'Проект определяет доступные машины и документы БЗ.', reason: props.project ? 'Проект привязан к разговору.' : 'Проект не привязан.', limitations: 'Доступ сохраняется, пока пользователь состоит в проекте.' }
    ]
    const skillItems: ContextItem[] = skills.map((skill) => ({ id: `skill-${encodeURIComponent(skill.name)}`, title: skill.name, technicalName: skill.name, description: skill.description || 'Навык выбранной машины', type: 'Навык', source: 'Политика машины', scope: props.agent?.name ?? 'Машина', status: selected.has(skill.name) ? 'Применяется' : 'Не выбран', priority: 'Навыки', details: skill.description || 'Специализированный рабочий процесс.', reason: selected.has(skill.name) ? 'Выбран в настройках разговора.' : 'Доступен на машине, но не выбран.', limitations: selected.has(skill.name) ? 'Наличие в чате не означает активацию в каждом ходе.' : 'Инструкция не добавляется в ход.' }))
    const remoteStatus: ContextStatus = props.agent?.online ? 'Доступен' : 'Недоступен'
    const kbStatus: ContextStatus = props.kbMode === 'off' ? 'Недоступен' : 'Доступен'
    const tools = [
      tool('remote-machines', 'Список машин проекта', 'MCP remote', 'Показывает доступные машины и их онлайн-статус.', remoteStatus, false, ['machine'], 'Не раскрывает чужие машины.'),
      tool('remote-read', 'Чтение удалённого файла', 'MCP remote', 'Читает окно строк файла в рабочей директории.', remoteStatus, false, ['path', 'offset', 'limit', 'machine'], 'Только доступные пути.'),
      tool('remote-edit', 'Изменение удалённого файла', 'MCP remote', 'Точно заменяет текст в файле.', remoteStatus, true, ['path', 'oldString', 'newString', 'machine'], 'Ограничено режимом прав и политикой машины.'),
      tool('remote-bash', 'Команда на удалённой машине', 'MCP remote', 'Выполняет shell-команду в рабочем каталоге.', remoteStatus, true, ['command', 'timeout_ms', 'machine'], 'Потенциально опасное действие.'),
      tool('kb-search', 'Поиск по базе знаний', 'MCP kb', 'Ищет доступные разделы базы знаний.', kbStatus, false, ['query', 'limit'], 'Результаты фильтруются по пользователю и проекту.'),
      tool('kb-document', 'Чтение документа базы знаний', 'MCP kb', 'Читает доступный раздел по устойчивому id.', kbStatus, false, ['documentId', 'anchor'], 'Недоступный документ не раскрывается.')
    ]
    const emptySkill: ContextItem = { id: 'skills-empty', title: 'Навыки не настроены', description: 'На выбранной машине нет доступных навыков.', type: 'Навык', source: 'Политика машины', scope: 'Текущий разговор', status: 'Недоступен', priority: 'Навыки', details: 'Добавьте навык машине и выберите его в разговоре.', reason: 'Список пуст.', limitations: 'Инструкция не добавляется.' }
    const kb: ContextItem = { id: 'kb-mode', title: 'Режим базы знаний', description: props.kbMode === 'auto' ? 'Авто-контекст и инструменты включены' : props.kbMode === 'manual' ? 'Только запросы модели' : 'База знаний отключена', type: 'Автоматический контекст', source: 'ChatAI KB', scope: 'Следующий ход', status: props.kbMode === 'off' ? 'Не выбран' : 'Применяется', priority: 'База знаний и автоматически добавленный контекст', details: props.kbMode === 'auto' ? 'Сервер может добавить разделы; обращения модели учитываются отдельно.' : 'Автоматическая вставка отсутствует.', reason: `Выбран режим ${props.kbMode}.`, limitations: 'Фактические документы зависят от запроса и прав.' }
    const history: ContextItem = { id: 'conversation-history', title: 'История и текущее сообщение', description: 'Сообщения, вложения и текущая задача.', type: 'Пользовательский контекст', source: 'Текущий разговор', scope: 'Текущий ход', status: 'Применяется', priority: 'История и пользовательское сообщение', details: 'Новое сообщение уточняет результат и стиль, но не отменяет правила выше.', reason: 'Основной источник текущей задачи.', limitations: 'Снимок прошлого хода может отличаться.' }
    return [
      { id: 'system', level: 1, title: 'Системные правила платформы', description: 'Наивысший приоритет; действуют всегда.', items: systemItems },
      { id: 'application', level: 2, title: 'Инструкции приложения ChatAI', description: 'Правила приложения независимо от проекта.', items: appItems },
      { id: 'project', level: 3, title: 'Инструкции проекта и рабочей директории', description: 'Иерархия файлов инструкций.', items: projectItems },
      { id: 'settings', level: 4, title: 'Настройки текущего разговора', description: 'Конфигурация следующего хода.', items: settings },
      { id: 'skills', level: 5, title: 'Навыки', description: 'Доступность отделена от выбора и активации.', items: skillItems.length ? skillItems : [emptySkill] },
      { id: 'tools', level: 6, title: 'MCP-инструменты и приложения', description: 'Возможности, а не уровень команд.', items: tools },
      { id: 'kb', level: 7, title: 'База знаний и автоматически добавленный контекст', description: 'Автоинъекция и запросы учитываются отдельно.', items: [kb] },
      { id: 'history', level: 8, title: 'История разговора и пользовательское сообщение', description: 'Основной источник текущей задачи.', items: [history] }
    ]
  }, [props.agent, props.kbMode, props.model, props.permissionMode, props.project, props.provider, props.selectedSkillNames, props.workdir])

  const allItems = groups.flatMap((group) => group.items)
  const detail = detailId ? allItems.find((item) => item.id === detailId) : undefined
  const tools = groups.find((group) => group.id === 'tools')?.items.filter((item) => item.status === 'Доступен').length ?? 0
  const instructions = groups.slice(0, 4).flatMap((group) => group.items).filter((item) => ['Применяется', 'Скрытый текст', 'Ограничен'].includes(item.status)).length
  const openDetail = (id: string): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}/context/${encodeURIComponent(id)}`; setDetailId(id) }
  const closeDetail = (): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}`; setDetailId(null) }

  if (detail) return <section className="context-detail" aria-labelledby="context-detail-title">
    <Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button>
    <header><span className="context-type">{detail.type}</span><h2 id="context-detail-title">{detail.title}</h2><p>{detail.details}</p></header>
    <dl className="context-metadata"><div><dt>Приоритет</dt><dd>{detail.priority}</dd></div><div><dt>Источник</dt><dd>{detail.source}</dd></div><div><dt>Область действия</dt><dd>{detail.scope}</dd></div><div><dt>Статус</dt><dd><span className="context-status">{detail.status}</span></dd></div><div><dt>Почему применяется</dt><dd>{detail.reason}</dd></div><div><dt>Ограничения</dt><dd>{detail.limitations}</dd></div>{detail.technicalName && <div><dt>Техническое имя</dt><dd><code>{detail.technicalName}</code></dd></div>}{detail.parameters && <div><dt>Параметры верхнего уровня</dt><dd>{detail.parameters.join(', ')}</dd></div>}{detail.mutates !== undefined && <div><dt>Изменение данных</dt><dd>{detail.mutates ? 'Может изменять данные' : 'Только чтение'}</dd></div>}</dl>
    {detail.status === 'Скрытый текст' && <p className="context-secret-note">Полный текст недоступен, показано описание.</p>}
  </section>

  return <section className="context-inspector" aria-labelledby="context-inspector-title">
    <div className="context-summary"><div><span className="context-eyebrow">Что действует прямо сейчас</span><h2 id="context-inspector-title">{props.provider} · {props.model || 'модель из конфигурации'}</h2><p>{props.agent ? `Работа с файлами выполняется на ${props.agent.name}` : 'Удалённая машина не выбрана'}. Режим прав: {props.permissionMode}. БЗ: {props.kbMode}.</p></div><dl><div><dt>Инструкции</dt><dd>{instructions}</dd></div><div><dt>Навыки</dt><dd>{props.selectedSkillNames.length}</dd></div><div><dt>Инструменты</dt><dd>{tools}</dd></div></dl></div>
    <aside className="context-conflicts"><b>Как разрешаются конфликты</b><p>Применяется инструкция более высокого уровня. Более конкретная инструкция одного уровня может уточнять общую, если не противоречит ей. Инструменты сами по себе не являются уровнем команд.</p></aside>
    <div className="context-groups">{groups.map((group) => <details className="context-group" key={group.id} open={group.level <= 4}><summary><span className="context-level">{group.level}</span><span><b>{group.title}</b><small>{group.description}</small></span><span className="context-count">{group.items.length}</span></summary><div className="context-items" role="list">{group.items.map((item) => <div role="listitem" key={item.id}><button type="button" className="context-item" onClick={() => openDetail(item.id)}><span className="context-item-main"><span className="context-type">{item.type}</span><b>{item.title}</b><small>{item.description}</small></span><span className="context-item-meta"><span>{item.source}</span><span>{item.scope}</span><span className="context-status">{item.status}</span></span><span aria-hidden="true">→</span></button></div>)}</div></details>)}</div>
    <details className="context-plugins"><summary>Можно подключить</summary><p>Неустановленные плагины не являются активными возможностями.</p><span className="context-status">Не установлен</span> GitHub · Figma · Notion · Slack · Google Drive</details>
  </section>
}
