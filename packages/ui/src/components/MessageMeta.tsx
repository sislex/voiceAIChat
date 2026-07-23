import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { MessageRole, TurnMeta } from '@shared/types'

/** Человекочитаемая роль сообщения контекста. */
function roleLabel(role: MessageRole): string {
  if (role === 'ai') return 'Ассистент'
  const n = role.slice(1)
  return n === '1' ? 'Пользователь' : `Спикер ${n}`
}

/** Число токенов в человекочитаемом виде (1.2k). */
function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Длительность хода в секундах. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`
}

/** Стоимость: $0.0123 для мелких сумм, $0.12 для крупных. */
function cost(usd: number): string {
  return `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`
}

/** Строка «label: value» для тултипа/панели (value скрывается, если пусто). */
function Row({ label, value }: { label: string; value: string | number | undefined }): JSX.Element | null {
  if (value === undefined || value === '' ) return null
  return (
    <div className="metarow">
      <span className="metalabel">{label}</span>
      <span className="metaval">{value}</span>
    </div>
  )
}

/** Список значений (инструменты/навыки/mcp) — чипсами; null, если пусто. */
function Chips({ label, items }: { label: string; items?: string[] }): JSX.Element | null {
  if (!items || items.length === 0) return null
  return (
    <div className="metablock">
      <p className="metahdr">
        {label} <span className="metacount">{items.length}</span>
      </p>
      <div className="metachips">
        {items.map((it) => (
          <span className="metachip" key={it}>
            {it}
          </span>
        ))}
      </div>
    </div>
  )
}

export interface MessageMetaProps {
  meta: TurnMeta
}

/**
 * Иконка ℹ у ответа модели: при наведении — краткая сводка (токены/размер/время/
 * модель), кнопка «Подробнее» открывает по клику панель со всем, что ушло модели.
 */
export function MessageMeta({ meta }: MessageMetaProps): JSX.Element {
  const [hover, setHover] = useState(false)
  const [open, setOpen] = useState(false)
  const req = meta.request
  const stop = (e: MouseEvent): void => e.stopPropagation()

  // Задержка закрытия тултипа: пока курсор идёт от иконки к тултипу (через зазор),
  // mouseleave не должен мгновенно его прятать — иначе не успеть нажать «Подробнее».
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const openTip = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setHover(true)
  }
  const scheduleClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHover(false), 180)
  }
  useEffect(() => () => closeTimer.current && clearTimeout(closeTimer.current), [])

  const inOut =
    typeof meta.inputTokens === 'number' && typeof meta.outputTokens === 'number'
      ? `${kilo(meta.inputTokens)} → ${kilo(meta.outputTokens)}`
      : undefined

  return (
    <span className="metawrap" onMouseEnter={openTip} onMouseLeave={scheduleClose}>
      <button
        className="msgbtn metabtn"
        aria-label="Сведения об ответе"
        title="Сведения об ответе"
        onClick={() => setOpen(true)}
      >
        ⓘ
      </button>

      {hover && !open && (
        <span className="metatip" role="tooltip" data-testid="meta-tip">
          <Row label="Модель" value={meta.model ?? req?.model} />
          <Row label="Токены (вход → выход)" value={inOut} />
          <Row label="Токены из кэша" value={meta.cacheReadTokens ? kilo(meta.cacheReadTokens) : undefined} />
          <Row label="Размер запроса" value={req ? `${req.promptChars.toLocaleString('ru')} симв.` : undefined} />
          <Row label="Время ответа" value={typeof meta.durationMs === 'number' ? seconds(meta.durationMs) : undefined} />
          <Row label="Стоимость" value={typeof meta.costUsd === 'number' ? cost(meta.costUsd) : undefined} />
          <button className="metamore" onClick={() => setOpen(true)}>
            Подробнее →
          </button>
        </span>
      )}

      {open && (
        <div className="ovl" onClick={() => setOpen(false)} data-testid="meta-overlay">
          <div className="modal metamodal" onClick={stop} role="dialog" aria-label="Подробности запроса">
            <div className="mdhead">
              <h2 className="mdh">Что было отправлено модели</h2>
              <button className="xbtn" aria-label="Закрыть" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="metamodal-body">
              <section className="metasec">
                <h3 className="metasech">Метрики хода</h3>
                <Row label="Движок" value={req?.provider} />
                <Row label="Модель" value={meta.model ?? req?.model} />
                <Row label="Токены входа" value={typeof meta.inputTokens === 'number' ? meta.inputTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены выхода" value={typeof meta.outputTokens === 'number' ? meta.outputTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены из кэша (чтение)" value={typeof meta.cacheReadTokens === 'number' ? meta.cacheReadTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены в кэш (запись)" value={typeof meta.cacheCreationTokens === 'number' ? meta.cacheCreationTokens.toLocaleString('ru') : undefined} />
                <Row label="Время ответа" value={typeof meta.durationMs === 'number' ? seconds(meta.durationMs) : undefined} />
                <Row label="Ходов агента" value={meta.numTurns} />
                <Row label="Стоимость" value={typeof meta.costUsd === 'number' ? cost(meta.costUsd) : undefined} />
                {req?.provider === 'codex' && meta.costUsd === undefined && (
                  <p className="metanote">Codex не сообщает стоимость хода.</p>
                )}
              </section>

              {req && (
                <>
                  <section className="metasec">
                    <h3 className="metasech">Параметры запроса</h3>
                    <Row label="Режим прав" value={req.permissionMode} />
                    <Row label="Рабочий каталог" value={req.cwd} />
                    <Row label="Выполнение команд" value={req.execTarget ? `машина «${req.execTarget}»` : 'на сервере'} />
                    <Row label="Продолжение сессии" value={req.resumed ? 'да (--resume)' : 'нет (новый контекст)'} />
                    <Row label="Размер запроса" value={`${req.promptChars.toLocaleString('ru')} симв.`} />
                    <Chips label="Вложения" items={req.attachments} />
                  </section>

                  {req.messages && req.messages.length > 0 && (
                    <section className="metasec">
                      <h3 className="metasech">
                        Отправленные сообщения (контекст){' '}
                        <span className="metacount">{req.messages.length}</span>
                      </h3>
                      <div className="metamsgs" data-testid="meta-messages">
                        {req.messages.map((m, i) => (
                          <div className={m.role === 'ai' ? 'metamsg ai' : 'metamsg'} key={i}>
                            <span className="metamsg-role">{roleLabel(m.role)}</span>
                            <p className="metamsg-text">{m.text}</p>
                          </div>
                        ))}
                      </div>
                      <p className="metanote">
                        {req.resumed
                          ? 'История хранится в сессии CLI и в этом ходе повторно не пересылается — показана для наглядности.'
                          : 'Полный контекст пересобран из истории и отправлен этим ходом.'}
                      </p>
                    </section>
                  )}

                  <section className="metasec">
                    <h3 className="metasech">Промпт этого хода (как ушёл в CLI)</h3>
                    <pre className="metapre" data-testid="meta-prompt">{req.prompt || '(пусто)'}</pre>
                  </section>

                  {(req.tools || req.slashCommands || req.mcpServers) && (
                    <section className="metasec">
                      <h3 className="metasech">Окружение хода</h3>
                      <Chips label="Инструменты" items={req.tools} />
                      <Chips label="Навыки / команды" items={req.slashCommands} />
                      <Chips label="MCP-серверы" items={req.mcpServers} />
                    </section>
                  )}

                  <p className="metanote">
                    Внутренний системный промпт CLI (встроенные инструкции, схемы инструментов,
                    CLAUDE.md, тело навыков) не отдаётся наружу и здесь не показан.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  )
}
