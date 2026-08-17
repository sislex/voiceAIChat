// Фикстуры бесед: полный `Conversation` со всеми полями протокола. Раньше тесты
// собирали беседу частичным литералом с `as Conversation` — из-за приведения
// новое обязательное поле контракта в них не проявлялось. Здесь его увидит `tsc`.

import type { Conversation } from '@shared/types'
import { T0 } from './chat'

let seq = 0

export function makeConversation(over: Partial<Conversation> = {}): Conversation {
  seq += 1
  return {
    id: `c${seq}`,
    title: `Беседа ${seq}`,
    createdAt: T0,
    updatedAt: T0 + seq * 1000,
    messageCount: 2,
    claudeSessionId: null,
    execTarget: null,
    workdir: null,
    skillNames: [],
    llmProvider: null,
    llmModel: null,
    permissionMode: null,
    kbContextMode: 'auto',
    projectId: null,
    status: 'developing',
    lastExecTarget: null,
    ...over
  }
}

/** Список бесед на разные состояния карточки сайдбара. */
export function makeConversations(): Conversation[] {
  return [
    makeConversation({ id: 'c1', title: 'Голосовой ввод не стартует', execTarget: 'm1', lastExecTarget: 'm1', permissionMode: 'plan' }),
    makeConversation({ id: 'c2', title: 'Разбор упавшего CI-рана', status: 'planned', lastExecTarget: 'none', messageCount: 24 }),
    makeConversation({ id: 'c3', title: 'Беседа без сообщений', messageCount: 0, status: 'planning_done' }),
    makeConversation({
      id: 'c4',
      title: 'Очень длинное название беседы, которое не помещается в карточку сайдбара и должно обрезаться',
      status: 'done',
      messageCount: 312
    })
  ]
}
