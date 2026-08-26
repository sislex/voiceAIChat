import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@voicechat/ui-kit'
import type { MessageRole, TurnMeta } from '@shared/types'
import { estimateKbTokens } from '@shared/kb'
import { formatLiveUsage, messageCost } from '../lib/view'

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
  /** id сообщения — для data-testid блока токенов и стоимости. */
  messageId?: string
  /** Управляемое открытие позволяет вынести trigger в меню действий сообщения. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** Открыть раздел базы знаний (чипсы «База знаний» ведут в #/kb/:documentId). */
  onOpenKbDocument?: (documentId: string, anchor: string) => void
}

/**
 * Блок токенов/стоимости в подвале ответа — он же триггер сведений о ходе:
 * при наведении — краткая сводка (модель/токены/размер/время), по клику —
 * панель «Что было отправлено модели». Отдельной иконки ℹ нет: один элемент
 * вместо двух, а цифры и так подсказывают, что за ними стоит подробность.
 */
export function MessageMeta({ meta, messageId, open: controlledOpen, onOpenChange, hideTrigger = false, onOpenKbDocument }: MessageMetaProps): JSX.Element {
  const [hover, setHover] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }
  const req = meta.request

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

  // Символы БЗ этого хода — сумма по секциям (у старых ходов их нет: тогда
  // показываем только число разделов, а не выдуманный объём).
  const kbSections = req?.kbContext?.sections ?? []
  const kbChars = kbSections.reduce((sum, section) => sum + (section.chars ?? 0), 0)

  const inOut =
    typeof meta.inputTokens === 'number' && typeof meta.outputTokens === 'number'
      ? `${kilo(meta.inputTokens)} → ${kilo(meta.outputTokens)}`
      : undefined

  // Стоимость: реальную (costUsd от модели) или расчётную по тарифам — обе в тултипе.
  const costLine = messageCost(meta)
  const usage = formatLiveUsage(meta)

  return (
    <span className="metawrap" onMouseEnter={openTip} onMouseLeave={scheduleClose}>
      {!hideTrigger && <button
        type="button"
        className="msgact-count msgact-tokens"
        aria-label="Сведения об ответе"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={messageId ? `message-tokens-${messageId}` : 'message-tokens'}
        onClick={() => setOpen(true)}
        onFocus={openTip}
        onBlur={scheduleClose}
      >
        {usage && <span className="msgact-usage">{usage}</span>}
        {usage && costLine && <span className="msgact-sep"> · </span>}
        {costLine && <span className="msgact-cost" data-testid={messageId ? `message-cost-${messageId}` : 'message-cost'}>{costLine.text}</span>}
        {!usage && !costLine && <span aria-hidden="true">ⓘ</span>}
      </button>}

      {!hideTrigger && hover && !open && (
        <span className="metatip" role="tooltip" data-testid="meta-tip">
          <Row label="Модель" value={meta.model ?? req?.model} />
          <Row label="Статус" value={meta.interrupted ? 'прерван перезапуском сервера' : undefined} />
          <Row label="Токены (вход → выход)" value={inOut} />
          <Row label="Токены из кэша" value={meta.cacheReadTokens ? kilo(meta.cacheReadTokens) : undefined} />
          <Row label="Размер запроса" value={req ? `${req.promptChars.toLocaleString('ru')} симв.` : undefined} />
          <Row label="База знаний" value={req?.kbContext ? `${req.kbContext.sections.length} раздел(а)` : undefined} />
          <Row label="Время ответа" value={typeof meta.durationMs === 'number' ? seconds(meta.durationMs) : undefined} />
          <Row label={costLine?.estimated ? 'Стоимость (расчётная)' : 'Стоимость'} value={costLine?.text} />
          <button className="metamore" onClick={() => setOpen(true)}>
            Подробнее →
          </button>
        </span>
      )}

      {open && (
        <Dialog
          title="Что было отправлено модели"
          ariaLabel="Подробности запроса"
          size="md"
          testId="meta-overlay"
          onClose={() => setOpen(false)}
        >
            <div className="metamodal-body">
              <section className="metasec">
                <h3 className="metasech">Метрики хода</h3>
                <Row label="Движок" value={req?.provider} />
                <Row label="Модель" value={meta.model ?? req?.model} />
                <Row label="Статус" value={meta.interrupted ? 'прерван перезапуском сервера' : undefined} />
                <Row label="Токены входа" value={typeof meta.inputTokens === 'number' ? meta.inputTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены выхода" value={typeof meta.outputTokens === 'number' ? meta.outputTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены из кэша (чтение)" value={typeof meta.cacheReadTokens === 'number' ? meta.cacheReadTokens.toLocaleString('ru') : undefined} />
                <Row label="Токены в кэш (запись)" value={typeof meta.cacheCreationTokens === 'number' ? meta.cacheCreationTokens.toLocaleString('ru') : undefined} />
                <Row label="Время ответа" value={typeof meta.durationMs === 'number' ? seconds(meta.durationMs) : undefined} />
                <Row label="Ходов агента" value={meta.numTurns} />
                <Row label={costLine?.estimated ? 'Стоимость (расчётная)' : 'Стоимость'} value={costLine?.text} />
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
                    {kbSections.length > 0 && (
                      <div className="metablock">
                        <p className="metahdr">
                          База знаний <span className="metacount">{kbSections.length}</span>
                        </p>
                        <div className="metachips">
                          {kbSections.map((section) => {
                            const label = `${section.title} / ${section.heading}`
                            return onOpenKbDocument ? (
                              <button
                                className="metachip metachip--link"
                                key={`${section.documentId}#${section.anchor}`}
                                title={`Открыть «${label}» в базе знаний`}
                                onClick={() => onOpenKbDocument(section.documentId, section.anchor)}
                              >
                                {label}
                              </button>
                            ) : (
                              <span className="metachip" key={`${section.documentId}#${section.anchor}`}>{label}</span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <Row label="Символы из БЗ" value={kbChars ? kbChars.toLocaleString('ru') : undefined} />
                    <Row label="≈ токенов из БЗ" value={kbChars ? `${estimateKbTokens(kbChars).toLocaleString('ru')} (оценка chars / 4)` : undefined} />
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
        </Dialog>
      )}
    </span>
  )
}
