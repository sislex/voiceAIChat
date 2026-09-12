import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applicationCompatibility,
  applicationReleaseIdentity,
  type ApplicationDefinition,
  type ApplicationDeploymentRecord,
  type ApplicationEnvironmentName,
  type ApplicationReleaseOverview,
  type ApplicationReleaseRecord,
  type ApplicationVersionRequirement
} from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'
import { EmptyState, ErrorState, RefreshIndicator, Skeleton, useConfirm } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'
interface Props {
  projectId: string
  baseBranch: string
  owner: boolean
  api: RendererApi
}
const requirementLabels = {
  minVersion: 'Минимальная версия',
  maxVersionExclusive: 'Верхняя граница версии',
  minApiVersion: 'Минимальная версия API',
  maxApiVersionExclusive: 'Верхняя граница API'
}
const status: Record<string, string> = {
  preparing: 'Подготовка',
  ready: 'Готов к выпуску',
  failed: 'Ошибка',
  deploying: 'Установка',
  released: 'Установлен',
  uncertain: 'Требуется сверка'
}
/** Status pill tone reuses the legacy `.release-status` palette by data-status. */
const pillStatus: Record<string, string> = {
  preparing: 'checking', ready: 'ready', failed: 'failed', deploying: 'building', released: 'released', uncertain: 'health_check'
}
const environmentLabels: Record<ApplicationEnvironmentName, string> = { staging: 'Staging', production: 'Production' }
const empty: ApplicationReleaseOverview = {
  environment: { schemaVersion: 1, revision: 0, applications: [] },
  activeDeploymentId: null,
  releases: [],
  deployments: []
}
const fmtSeconds = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
}
/** Newest version first inside one application; applications in catalog order. */
export function sortApplicationReleases(records: readonly ApplicationReleaseRecord[], catalog: readonly ApplicationDefinition[]): ApplicationReleaseRecord[] {
  const order = new Map(catalog.map((app, index) => [app.id, index]))
  const version = (value: string): number[] => value.split('.').map((part) => Number(part) || 0)
  return [...records].sort((left, right) => {
    const byApp = (order.get(left.input.applicationId) ?? 99) - (order.get(right.input.applicationId) ?? 99)
    if (byApp !== 0) return byApp
    const a = version(left.input.version), b = version(right.input.version)
    for (let index = 0; index < 3; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (b[index] ?? 0) - (a[index] ?? 0)
    return right.createdAt - left.createdAt
  })
}
export function ApplicationReleaseCenter({
  projectId,
  baseBranch,
  owner,
  api
}: Props): JSX.Element {
  const confirm = useConfirm()
  const [catalog, setCatalog] = useState<ApplicationDefinition[]>([])
  const [applicationId, setApplicationId] = useState('make')
  const [environment, setEnvironment] =
    useState<ApplicationEnvironmentName>('staging')
  const [overview, setOverview] = useState(empty)
  const [selection, setSelection] = useState<string[]>([])
  const [version, setVersion] = useState(''),
    [image, setImage] = useState('')
  const [requirements, setRequirements] = useState<
    Record<string, ApplicationVersionRequirement>
  >({})
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0),
    pending = useRef<{ key: string; id: string } | null>(null)
  const app = catalog.find((item) => item.id === applicationId)
  const nameOf = useCallback((id: string): string => catalog.find((item) => item.id === id)?.name ?? id, [catalog])
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setRefreshing(true)
    try {
      const [apps, data] = await Promise.all([
        api['releases:applicationCatalog']({ projectId }),
        api['releases:applicationOverview']({ projectId, environment })
      ])
      if (request !== generation.current) return
      setCatalog(apps)
      setOverview(data)
      setError('')
      setLoading(false)
    } catch (error) {
      if (request === generation.current) {
        setError(error instanceof Error ? error.message : String(error))
        setLoading(false)
      }
    } finally {
      if (request === generation.current) setRefreshing(false)
    }
  }, [api, projectId, environment])
  useEffect(() => {
    setLoading(true)
    setOverview(empty)
    setSelection([])
    setError('')
    pending.current = null
    void refresh()
    return () => {
      generation.current++
    }
  }, [refresh])
  const live = Boolean(overview.activeDeploymentId) || overview.releases.some((record) => record.status === 'preparing')
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [live, refresh])
  const candidates = useMemo(
    () =>
      selection.flatMap((id) => {
        const record = overview.releases.find((record) => record.id === id)
        return record?.manifest ? [record.manifest] : []
      }),
    [overview, selection]
  )
  const issues = useMemo(() => {
    try {
      return applicationCompatibility(overview.environment, candidates).map(
        (issue) => issue.message
      )
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)]
    }
  }, [overview, candidates])
  const execute = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const deploy = async (rollbackOf?: string) => {
    // Production changes what users run right now: they are confirmed; staging
    // is the rehearsal environment and stays one click away.
    if (environment === 'production') {
      const names = rollbackOf
        ? overview.deployments.find((record) => record.id === rollbackOf)?.releases.map((item) => `${nameOf(item.applicationId)} ${item.version}`).join(', ') ?? ''
        : candidates.map((item) => `${nameOf(item.applicationId)} ${item.version}`).join(', ')
      const ok = await confirm({
        title: rollbackOf ? 'Откатить production?' : 'Установить в production?',
        message: rollbackOf ? `Окружение production вернётся к составу, который был до deploy «${names}».` : `В production будут установлены: ${names}.`,
        variant: 'danger',
        confirmLabel: rollbackOf ? 'Откатить' : 'Установить'
      })
      if (!ok) return
    }
    await execute(async () => {
      const input = {
        releaseIds: rollbackOf ? [] : selection,
        expectedRevision: overview.environment.revision,
        ...(rollbackOf ? { rollbackOf } : {})
      }
      const key = JSON.stringify({ environment, ...input })
      if (pending.current?.key !== key)
        pending.current = { key, id: crypto.randomUUID() }
      await api['releases:applicationDeploy']({
        projectId,
        environment,
        input: { ...input, requestId: pending.current.id }
      })
      pending.current = null
      setSelection([])
    })
  }
  const prepare = () =>
    execute(async () => {
      const requires = (app?.runtimeDependencies ?? []).map(
        (id) =>
          requirements[id] ?? {
            applicationId: id,
            minVersion: '',
            maxVersionExclusive: '',
            minApiVersion: '',
            maxApiVersionExclusive: ''
          }
      )
      await api['releases:applicationPrepare']({
        projectId,
        input: { applicationId, version, image, baseBranch, requires }
      })
      setVersion('')
    })
  const lastDeploy = overview.deployments.find(
    (record) => record.status === 'released'
  )
  const installed = overview.environment.applications.find(
    (item) => item.manifest.applicationId === applicationId
  )
  const releases = useMemo(() => sortApplicationReleases(overview.releases, catalog), [overview.releases, catalog])
  const changeRequirement = (
    id: string,
    field: keyof ApplicationVersionRequirement,
    value: string
  ) =>
    setRequirements((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          applicationId: id,
          minVersion: '',
          maxVersionExclusive: '',
          minApiVersion: '',
          maxApiVersionExclusive: ''
        }),
        [field]: value
      }
    }))
  const deployBlock = !owner ? '' : overview.activeDeploymentId ? 'Идёт установка — дождитесь её завершения.' : !selection.length ? 'Выберите хотя бы один готовый выпуск.' : issues.length ? 'Состав несовместим с окружением.' : ''
  const releaseStatus = (record: ApplicationReleaseRecord, current: boolean): string => current ? 'Установлен' : status[record.status] ?? record.status
  const deploymentLabel = (record: ApplicationDeploymentRecord): string => record.releases.map((item) => `${nameOf(item.applicationId)} ${item.version}`).join(', ') || 'Откат'
  return (
    <section
      className="application-release-center release-center"
      aria-label="Релизы приложений"
    >
      <div className="release-pane">
        <header>
          <div><h2>Приложения</h2><p>Независимые выпуски отдельных приложений: подготовка образа и установка в окружение</p></div>
          <span>
            {refreshing && !loading && <RefreshIndicator label="Обновляем выпуски…" />}
            <button
              className="vc-btn vc-btn--secondary"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              Обновить
            </button>
            {owner && (
              <button
                className="vc-btn vc-btn--secondary"
                disabled={busy || loading}
                title="Прочитать фактическое состояние окружения и сверить с записями"
                onClick={() =>
                  void execute(() =>
                    overview.activeDeploymentId
                      ? api['releases:applicationReconcile']({
                          projectId,
                          environment
                        })
                      : api['releases:applicationObserve']({
                          projectId,
                          environment,
                          expectedRevision: overview.environment.revision
                        })
                  )
                }
              >
                Сверить с окружением
              </button>
            )}
          </span>
        </header>
        <div className="application-release-controls release-create">
          <label>
            Приложение
            <select
              aria-label="Приложение"
              value={applicationId}
              onChange={(event) => setApplicationId(event.target.value)}
            >
              {catalog
                .filter((app) => app.kind !== 'library')
                .map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                    {app.isolation.deploy ? '' : ' — общий выпуск'}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Окружение
            <select
              aria-label="Окружение"
              value={environment}
              disabled={busy}
              onChange={(event) =>
                setEnvironment(event.target.value as ApplicationEnvironmentName)
              }
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </label>
        </div>
        {error && <ErrorState compact message="Операция не выполнена" detail={error} onRetry={() => void refresh()} />}
        {loading ? (
          <div aria-busy="true">
            <span className="vc-sr-only" aria-live="polite">Загрузка выпусков…</span>
            <Skeleton variant="list" item="block" count={4} height={56} gap={10} />
          </div>
        ) : (
          <>
            <div className="release-metrics application-release-installed" aria-label={`Установлено в ${environmentLabels[environment]}`}>
              <span>{app?.name ?? applicationId} в {environmentLabels[environment]}<br /><strong>{installed?.manifest.version ?? 'Нет подтверждённой версии'}</strong></span>
              <span>API<br /><strong>{installed?.manifest.apiVersion ?? '—'}</strong></span>
              <span>Health-check<br /><strong className={installed ? (installed.healthy ? 'application-release-ok' : 'application-release-bad') : undefined}>{installed ? (installed.healthy ? 'работает' : 'не пройден') : '—'}</strong></span>
              <span>Ревизия окружения<br /><strong>{overview.environment.revision}{live ? ' · обновляется' : ''}</strong></span>
            </div>
            {installed && (
              <details className="application-release-details">
                <summary>Артефакты установленной версии</summary>
                <ul>
                  {installed.manifest.artifacts.map((artifact) => (
                    <li key={artifact.service}>
                      <strong>{artifact.service}</strong>{' '}
                      <code>{artifact.reference}</code>
                    </li>
                  ))}
                </ul>
                <p>
                  SHA: <code>{installed.manifest.commit}</code>
                </p>
              </details>
            )}
            {app && !app.isolation.deploy && (
              <p role="status" className="release-transition">
                У этого приложения пока общий выпуск. Независимый deploy будет
                доступен после завершения его границ.
              </p>
            )}
            {app?.isolation.deploy && owner && (
              <form
                className="application-release-form release-create"
                aria-label={`Подготовить выпуск ${app.name}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  void prepare()
                }}
              >
                <h3>Подготовить выпуск {app.name}</h3>
                <div className="application-release-controls">
                  <label>
                    Версия
                    <input
                      aria-label="Версия приложения"
                      value={version}
                      placeholder="1.2.0"
                      inputMode="decimal"
                      required
                      pattern="[0-9]+\.[0-9]+\.[0-9]+"
                      onChange={(event) => setVersion(event.target.value)}
                    />
                  </label>
                  <label>
                    Образ в registry
                    <input
                      aria-label="Образ в registry"
                      value={image}
                      placeholder="registry.example/team/make"
                      required
                      onChange={(event) => setImage(event.target.value)}
                    />
                  </label>
                </div>
                {!!app.runtimeDependencies.length && (
                  <>
                    <p className="release-field-hint">
                      Укажите проверяемый диапазон зависимостей. Верхняя граница
                      не включается.
                    </p>
                    <div className="application-release-table release-table-wrap">
                      <table className="release-table">
                        <thead>
                          <tr>
                            <th scope="col">Зависимость</th>
                            <th scope="col">Версия от</th>
                            <th scope="col">Версия до</th>
                            <th scope="col">API от</th>
                            <th scope="col">API до</th>
                          </tr>
                        </thead>
                        <tbody>
                          {app.runtimeDependencies.map((id) => (
                            <tr key={id}>
                              <th scope="row" data-label="Зависимость">
                                {nameOf(id)}
                              </th>
                              {(
                                [
                                  'minVersion',
                                  'maxVersionExclusive',
                                  'minApiVersion',
                                  'maxApiVersionExclusive'
                                ] as const
                              ).map((field) => (
                                <td key={field} data-label={requirementLabels[field]}>
                                  <input
                                    aria-label={`${nameOf(id)}: ${requirementLabels[field]}`}
                                    required
                                    inputMode="decimal"
                                    placeholder={
                                      field.startsWith('max') ? '2.0.0' : '1.0.0'
                                    }
                                    value={requirements[id]?.[field] ?? ''}
                                    onChange={(event) =>
                                      changeRequirement(
                                        id,
                                        field,
                                        event.target.value
                                      )
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <button className="vc-btn vc-btn--primary" disabled={busy}>
                  Подготовить приложение
                </button>
              </form>
            )}
            <header className="application-release-section">
              <div><h3>Доступные выпуски</h3><p>Для согласованного обновления можно выбрать версии нескольких приложений — по одной на приложение.</p></div>
            </header>
            {!releases.length ? (
              <EmptyState compact title="Подготовленных выпусков пока нет" description={owner ? 'Подготовьте выпуск приложения — он появится в этом списке.' : 'Выпуски появятся после подготовки владельцем проекта.'} />
            ) : (
              <ul className="application-release-list" aria-label="Доступные выпуски">
                {releases.map((record) => {
                  const actual = overview.environment.applications.find(
                    (item) =>
                      item.manifest.applicationId === record.input.applicationId
                  )
                  const current =
                    !!record.manifest &&
                    !!actual &&
                    applicationReleaseIdentity(record.manifest) ===
                      applicationReleaseIdentity(actual.manifest)
                  return (
                    <li key={record.id} className="application-release-item" data-status={current ? 'released' : record.status}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selection.includes(record.id)}
                          disabled={
                            !owner ||
                            busy ||
                            record.status !== 'ready' ||
                            current ||
                            !!overview.activeDeploymentId
                          }
                          onChange={(event) =>
                            setSelection((previous) =>
                              event.target.checked
                                ? [
                                    ...previous.filter(
                                      (id) =>
                                        overview.releases.find(
                                          (item) => item.id === id
                                        )?.input.applicationId !==
                                        record.input.applicationId
                                    ),
                                    record.id
                                  ]
                                : previous.filter((id) => id !== record.id)
                            )
                          }
                        />
                        <strong>{nameOf(record.input.applicationId)} {record.input.version}</strong>
                        <span className="release-status" data-status={current ? 'released' : pillStatus[record.status] ?? record.status}>{releaseStatus(record, current)}</span>
                      </label>
                      <p className="application-release-meta">
                        {record.manifest
                          ? record.manifest.requires
                            .map(
                              (dep) =>
                                `${nameOf(dep.applicationId)} ≥${dep.minVersion} <${dep.maxVersionExclusive}`
                            )
                            .join('; ') || 'Без зависимостей от приложений'
                          : record.status === 'preparing' ? 'Подготовка выполняется…' : 'Манифест не собран'}
                      </p>
                      <details>
                        <summary>Подготовка и артефакты</summary>
                        <p>
                          {record.branch} · {formatDateTime(record.createdAt)} · {record.triggeredBy}
                        </p>
                        {record.manifest?.artifacts.map((artifact) => (
                          <p key={artifact.service}>
                            <code>{artifact.reference}</code>
                          </p>
                        ))}
                        <pre>{record.log || 'Подготовка выполняется'}</pre>
                      </details>
                    </li>
                  )
                })}
              </ul>
            )}
            {!!selection.length && (
              <div role="status" className={issues.length ? 'application-release-issues' : 'application-release-compatible'}>
                {issues.length ? (
                  <ul>
                    {issues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Выбранный состав совместим с окружением.</p>
                )}
              </div>
            )}
            {owner && (
              <div className="application-release-actions">
                <button
                  className="vc-btn vc-btn--primary"
                  disabled={
                    busy ||
                    !selection.length ||
                    !!issues.length ||
                    !!overview.activeDeploymentId
                  }
                  title={deployBlock || undefined}
                  onClick={() => void deploy()}
                >
                  Установить выбранные версии
                </button>
                {deployBlock && <span className="release-field-hint">{deployBlock}</span>}
              </div>
            )}
            <header className="application-release-section">
              <div><h3>История deploy</h3><p>Установки в {environmentLabels[environment]}: состав, результат проверки и откат последней.</p></div>
            </header>
            {!overview.deployments.length ? (
              <EmptyState compact title="Установок пока нет" description="Выберите готовые выпуски и установите их в окружение." />
            ) : (
              <ol className="application-release-list" aria-label="История deploy">
                {overview.deployments.map((record) => (
                  <li key={record.id} className="application-release-item" data-status={record.status}>
                    <div className="application-release-item-head">
                      <strong>{record.rollbackOf ? `Откат deploy · ${deploymentLabel(record)}` : deploymentLabel(record)}</strong>
                      <span className="release-status" data-status={pillStatus[record.status] ?? record.status}>{status[record.status] ?? record.status}</span>
                    </div>
                    <p className="application-release-meta">
                      {formatDateTime(record.createdAt)} · {record.triggeredBy}
                      {record.finishedAt
                        ? ` · ${fmtSeconds(record.finishedAt - record.createdAt)}`
                        : ' · выполняется'}
                    </p>
                    <details>
                      <summary>Результат проверки</summary>
                      <pre>{record.log || 'Проверка выполняется'}</pre>
                    </details>
                    {owner &&
                      record.id === lastDeploy?.id &&
                      record.releases.every((release) =>
                        record.previous.applications.some(
                          (item) =>
                            item.manifest.applicationId === release.applicationId
                        )
                      ) && (
                        <button
                          className="vc-btn vc-btn--secondary"
                          disabled={busy || !!overview.activeDeploymentId}
                          onClick={() => void deploy(record.id)}
                        >
                          Откатить этот deploy
                        </button>
                      )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </section>
  )
}
