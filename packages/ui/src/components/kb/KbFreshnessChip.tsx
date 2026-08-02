// Свежесть раздела базы знаний одной подписью. Тон — только токенами темы:
// «сверен» нейтрально-зелёный, «устарел» предупреждающий, «дата не указана» —
// приглушённый (это не ошибка, а отсутствие поля `updated` во фронтматтере).

import type { KbFreshness } from '@shared/kb'

const LABEL: Record<KbFreshness, string> = {
  current: 'сверен с кодом',
  stale: 'требует сверки',
  unknown: 'дата сверки не указана'
}

export function KbFreshnessChip({ freshness }: { freshness: KbFreshness }): JSX.Element {
  return <span className={`kbu-fresh kbu-fresh--${freshness}`}>{LABEL[freshness]}</span>
}

/** Тот же текст без разметки — для aria-label и тултипов. */
export function kbFreshnessLabel(freshness: KbFreshness): string {
  return LABEL[freshness]
}
