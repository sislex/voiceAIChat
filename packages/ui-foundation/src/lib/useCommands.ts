// React-подключение реестра команд (сам реестр — commands.ts, без React).
//
// Источник хранится в ref и регистрируется один раз за жизнь экрана: колбэки
// команд замыкают пропсы, и если перерегистрировать источник на каждый рендер,
// открытая палитра пересобиралась бы на каждое нажатие клавиши.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  commandsRevision,
  listCommands,
  registerCommandSource,
  subscribeCommands,
  type Command,
  type CommandSource
} from './commands'

/**
 * Регистрирует команды экрана на время его жизни. Функция вызывается в момент
 * сборки списка, поэтому возвращать можно свежие данные пропсов.
 */
export function useCommandSource(source: CommandSource): void {
  const ref = useRef(source)
  ref.current = source
  useEffect(() => registerCommandSource(() => ref.current()), [])
}

/**
 * Версия состава реестра. Нужна тем, кто не собирает список сам, а только
 * пересчитывает свой снимок доступных команд (контекст канбан-ассистента).
 */
export function useCommandsRevision(): number {
  const [revision, setRevision] = useState(commandsRevision)
  useEffect(() => subscribeCommands(() => setRevision(commandsRevision())), [])
  return revision
}

/**
 * Состав реестра для палитры и шпаргалки. Пересобирается при открытии окна и
 * когда экран пришёл или ушёл; на каждое нажатие клавиши — нет (данные за время
 * набора запроса не меняются, а сборка списка из сотен бесед не бесплатна).
 */
export function useCommandRegistry(active: boolean): Command[] {
  const revision = useCommandsRevision()
  return useMemo(() => (active ? listCommands() : []), [active, revision])
}
