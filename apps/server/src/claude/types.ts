// Абстракция LLM-клиента. Сами типы переехали в `@voicechat/shared` (`llm.ts`):
// по `LlmRequest` теперь работает и исполнитель CLI (`apps/llm-runner`), а общий
// контракт двух пакетов живёт только в shared.
//
// Модуль остался реэкспортом: `LlmClient`/`LlmRequest` импортируют десятки файлов
// сервера (turns, ci, kb, gateway), и переписывать их ради переезда типов незачем.

export type {
  LlmClient,
  LlmHandle,
  LlmRequest,
  LlmStreamHandlers
} from '@voicechat/shared'
