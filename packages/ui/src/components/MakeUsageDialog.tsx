// «Место» проекта Make (п.30): полоса квоты по составляющим (файлы / снимки / PNG стори) и очистка —
// оставить N последних снимков, убрать PNG-снимки стори, удалить ассеты без ссылок. Удаление
// необратимо, поэтому кнопка проходит через useConfirm.
import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectState, MakeUsage } from '@shared/make'
import { Button, Dialog, Skeleton, useConfirm, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:usage' | 'make:cleanup'>
  onClose: () => void
  onChanged: (next: MakeProjectState) => void
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} КБ`
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} МБ`
}

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MakeUsageDialog({ conversationId, api, onClose, onChanged }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [usage, setUsage] = useState<MakeUsage | null>(null)
  const [keep, setKeep] = useState(10)
  const [dropSnapshots, setDropSnapshots] = useState(false)
  const [dropShots, setDropShots] = useState(false)
  const [dropAssets, setDropAssets] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try { setUsage(await api['make:usage']({ conversationId })) } catch (e) { toast.error(describeError(e)) }
  }, [api, conversationId, toast])
  useEffect(() => { void load() }, [load])

  const nothing = !dropSnapshots && !dropShots && !dropAssets
  const run = async (): Promise<void> => {
    if (!usage || nothing) return
    const parts: string[] = []
    if (dropSnapshots) parts.push(`снимки, кроме ${keep} последних`)
    if (dropShots) parts.push(`${usage.shotsCount} PNG-снимков стори`)
    if (dropAssets) parts.push(`${usage.unusedAssets.length} неиспользуемых ассетов`)
    const ok = await confirm({ title: 'Очистить проект?', message: `Будут удалены: ${parts.join('; ')}. Восстановить их нельзя.`, variant: 'danger', confirmLabel: 'Удалить' })
    if (!ok) return
    setBusy(true)
    try {
      const result = await api['make:cleanup']({ conversationId, ...(dropSnapshots ? { keepSnapshots: keep } : {}), shots: dropShots, unusedAssets: dropAssets })
      setUsage(result.usage)
      onChanged(result.state)
      setDropSnapshots(false); setDropShots(false); setDropAssets(false)
      toast.success(`Освобождено ${formatBytes(result.freedBytes)}: снимков ${result.removed.snapshots}, PNG ${result.removed.shots}, ассетов ${result.removed.assets}`)
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const pct = usage ? Math.min(100, Math.round((usage.totalBytes / usage.limitBytes) * 100)) : 0
  const seg = (bytes: number): string => (usage ? `${(bytes / usage.limitBytes) * 100}%` : '0%')
  return (
    <Dialog className="make-dialog" title="Место проекта" ariaLabel="Место проекта" size="sm" onClose={onClose} testId="make-usage"
      footer={<Button size="sm" variant="danger" disabled={!usage || nothing || busy} loading={busy} onClick={() => void run()}>Очистить</Button>}>
      {!usage ? <Skeleton height={64} /> : (
        <div className="make-usage">
          <div className="make-usage-bar" role="img" aria-label={`Занято ${formatBytes(usage.totalBytes)} из ${formatBytes(usage.limitBytes)} (${pct}%)`}>
            <span className="make-usage-seg make-usage-seg--files" style={{ width: seg(usage.filesBytes) }} />
            <span className="make-usage-seg make-usage-seg--snaps" style={{ width: seg(usage.snapshotsBytes) }} />
            <span className="make-usage-seg make-usage-seg--shots" style={{ width: seg(usage.shotsBytes) }} />
          </div>
          <p className="make-usage-total" data-testid="make-usage-total"><strong>{formatBytes(usage.totalBytes)}</strong> из {formatBytes(usage.limitBytes)} · {pct}%</p>
          <ul className="make-usage-legend" role="list">
            <li><i className="make-usage-seg--files" /> Файлы: {usage.filesCount} · {formatBytes(usage.filesBytes)}</li>
            <li><i className="make-usage-seg--snaps" /> Снимки: {usage.snapshotsCount} · {formatBytes(usage.snapshotsBytes)}</li>
            <li><i className="make-usage-seg--shots" /> PNG стори: {usage.shotsCount} · {formatBytes(usage.shotsBytes)}</li>
          </ul>
          <fieldset className="make-usage-clean">
            <legend>Что очистить</legend>
            <label className="make-usage-opt"><input type="checkbox" checked={dropSnapshots} disabled={usage.snapshotsCount === 0} onChange={(e) => setDropSnapshots(e.target.checked)} /> Старые снимки — оставить
              <input type="number" className="tin make-usage-keep" aria-label="Сколько снимков оставить" min={0} max={usage.snapshotsCount} value={keep} disabled={!dropSnapshots} onChange={(e) => setKeep(Math.max(0, Number(e.target.value) || 0))} /> последних{usage.snapshotsCount ? ` из ${usage.snapshotsCount}` : ''}</label>
            <label className="make-usage-opt"><input type="checkbox" checked={dropShots} disabled={usage.shotsCount === 0} onChange={(e) => setDropShots(e.target.checked)} /> PNG-снимки стори ({usage.shotsCount}, {formatBytes(usage.shotsBytes)})</label>
            <label className="make-usage-opt"><input type="checkbox" checked={dropAssets} disabled={usage.unusedAssets.length === 0} onChange={(e) => setDropAssets(e.target.checked)} /> Ассеты без ссылок ({usage.unusedAssets.length}{usage.unusedAssets.length ? `: ${usage.unusedAssets.slice(0, 3).map((a) => a.path).join(', ')}${usage.unusedAssets.length > 3 ? '…' : ''}` : ''})</label>
          </fieldset>
          <p className="fsub">Снимок, закреплённый в публикации, не удаляется. Квота считается вместе со снимками — они копируют все файлы проекта.</p>
        </div>
      )}
    </Dialog>
  )
}
