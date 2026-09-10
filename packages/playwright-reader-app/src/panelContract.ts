import type { RendererBrowserBridge } from '@shared/ipc'
import type { ProjectTestUser } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'


export interface BrowserSessionPaneProps {
  conversationId: string
  initialUrl?: string | null
  onPageChange?: (url: string) => void | Promise<void>
  browser?: RendererBrowserBridge
  /** Приложить кадр к сообщению чата: панель отдаёт data-URL, хост решает, что с ним делать. */
  onAttachFrame?: (dataUrl: string) => void
  /**
   * Тестовые учётки проекта. Без них проверять сайт можно только до экрана
   * входа, а логин руками при каждом перезапуске сессии — главная морока.
   */
  testUsers?: ProjectTestUser[]
  /**
   * Сохранить записанный сценарий в настройки проекта. Без этого запись живёт
   * только в буфере обмена, и её надо переносить руками на другой экран — для
   * «много автотестов» это главный барьер.
   */
  onSaveScenario?: (scenario: AutomatedQaScenario) => Promise<void>
  /**
   * Сценарии, уже сохранённые в проекте. Без них существующий сценарий нельзя
   * поправить — только записать заново.
   */
  savedScenarios?: AutomatedQaScenario[]
}
