// Общие фикстуры домена для сториз и `*.dom.test.tsx` — один источник правды.
//
// Собраны по образцу `components/kanban/fixtures.ts` (доска живёт там же, рядом
// со своими компонентами): чат, CI-раннер, машины, беседы. Типы — только из
// `@shared`, поэтому расхождение фикстуры с протоколом ловится `tsc`.

export * from './chat'
export * from './ci'
export * from './machines'
export * from './conversations'
export * from './kb'
export * from './clarification'
