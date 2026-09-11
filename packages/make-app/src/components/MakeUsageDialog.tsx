import { Dialog, useConfirm, useToast } from '../i18n/ui'
import { mt, useMakeLocale } from '../i18n'
// Make project storage (item 30): show quota usage by files, snapshots, and story PNGs. Cleanup can
// retain the latest N snapshots, remove story images, and delete unreferenced assets. Deletion is
// irreversible, so require useConfirm.
import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectState, MakeUsage } from '@shared/make'
import { Button, Skeleton } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:usage' | 'make:cleanup'>
  onClose: () => void
  onChanged: (next: MakeProjectState) => void
}

export function formatBytes(n: number): string {
  if (n < 1024) return mt("valueB", { p0: n })
  if (n < 1024 * 1024) return mt("valueKb", { p0: (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) })
  return mt("valueMb", { p0: (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0) })
}

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function MakeUsageDialog({ conversationId, api, onClose, onChanged }: Props): JSX.Element {
  useMakeLocale()
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
    if (dropSnapshots) parts.push(mt("snapshotsExceptTheLatestValue", { p0: keep }))
    if (dropShots) parts.push(mt("valueStoryPngScreenshots", { p0: usage.shotsCount }))
    if (dropAssets) parts.push(mt("valueUnusedAssets", { p0: usage.unusedAssets.length }))
    const ok = await confirm({ title: mt("cleanUpProject"), message: mt("theFollowingWillBeDeletedValueThisCannotBe", { p0: parts.join('; ') }), variant: 'danger', confirmLabel: mt("delete") })
    if (!ok) return
    setBusy(true)
    try {
      const result = await api['make:cleanup']({ conversationId, ...(dropSnapshots ? { keepSnapshots: keep } : {}), shots: dropShots, unusedAssets: dropAssets })
      setUsage(result.usage)
      onChanged(result.state)
      setDropSnapshots(false); setDropShots(false); setDropAssets(false)
      toast.success(mt("freedValueValueSnapshotsValuePngsValueAssets", { p0: formatBytes(result.freedBytes), p1: result.removed.snapshots, p2: result.removed.shots, p3: result.removed.assets }))
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const pct = usage ? Math.min(100, Math.round((usage.totalBytes / usage.limitBytes) * 100)) : 0
  const seg = (bytes: number): string => (usage ? `${(bytes / usage.limitBytes) * 100}%` : '0%')
  return (
    <Dialog className="make-dialog" padded title={mt("projectStorage")} ariaLabel={mt("projectStorage")} size="sm" onClose={onClose} testId="make-usage"
      footer={<Button size="sm" variant="danger" disabled={!usage || nothing || busy} loading={busy} onClick={() => void run()}>{mt("clear")}</Button>}>
      {!usage ? <Skeleton height={64} /> : (
        <div className="make-usage">
          <div className="make-usage-bar" role="img" aria-label={mt("usedValueOfValueValue", { p0: formatBytes(usage.totalBytes), p1: formatBytes(usage.limitBytes), p2: pct })}>
            <span className="make-usage-seg make-usage-seg--files" style={{ width: seg(usage.filesBytes) }} />
            <span className="make-usage-seg make-usage-seg--snaps" style={{ width: seg(usage.snapshotsBytes) }} />
            <span className="make-usage-seg make-usage-seg--shots" style={{ width: seg(usage.shotsBytes) }} />
          </div>
          <p className="make-usage-total" data-testid="make-usage-total"><strong>{formatBytes(usage.totalBytes)}</strong>{' '}{mt("of")}{' '}{formatBytes(usage.limitBytes)} · {pct}%</p>
          <ul className="make-usage-legend" role="list">
            <li><i className="make-usage-seg--files" />{' '}{mt("files_b66d19")}{' '}{usage.filesCount} · {formatBytes(usage.filesBytes)}</li>
            <li><i className="make-usage-seg--snaps" />{' '}{mt("snapshots_a3619b")}{' '}{usage.snapshotsCount} · {formatBytes(usage.snapshotsBytes)}</li>
            <li><i className="make-usage-seg--shots" />{' '}{mt("storyPngs")}{' '}{usage.shotsCount} · {formatBytes(usage.shotsBytes)}</li>
          </ul>
          <fieldset className="make-usage-clean">
            <legend>{mt("whatToCleanUp")}</legend>
            <label className="make-usage-opt"><input type="checkbox" checked={dropSnapshots} disabled={usage.snapshotsCount === 0} onChange={(e) => setDropSnapshots(e.target.checked)} />{' '}{mt("oldSnapshotsKeep")}<input type="number" className="tin make-usage-keep" aria-label={mt("numberOfSnapshotsToKeep")} min={0} max={usage.snapshotsCount} value={keep} disabled={!dropSnapshots} onChange={(e) => setKeep(Math.max(0, Number(e.target.value) || 0))} />{' '}{mt("latest")}{usage.snapshotsCount ? mt("ofValue", { p0: usage.snapshotsCount }) : ''}</label>
            <label className="make-usage-opt"><input type="checkbox" checked={dropShots} disabled={usage.shotsCount === 0} onChange={(e) => setDropShots(e.target.checked)} />{' '}{mt("storyPngScreenshots")}{usage.shotsCount}, {formatBytes(usage.shotsBytes)})</label>
            <label className="make-usage-opt"><input type="checkbox" checked={dropAssets} disabled={usage.unusedAssets.length === 0} onChange={(e) => setDropAssets(e.target.checked)} />{' '}{mt("unreferencedAssets")}{usage.unusedAssets.length}{usage.unusedAssets.length ? `: ${usage.unusedAssets.slice(0, 3).map((a) => a.path).join(', ')}${usage.unusedAssets.length > 3 ? '…' : ''}` : ''})</label>
          </fieldset>
          <p className="fsub">{mt("snapshotsPinnedToAPublicationArePreservedSnapshotsCount")}</p>
        </div>
      )}
    </Dialog>
  )
}
