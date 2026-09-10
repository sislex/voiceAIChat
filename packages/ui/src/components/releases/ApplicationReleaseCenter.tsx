import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applicationCompatibility,
  applicationReleaseIdentity,
  type ApplicationDefinition,
  type ApplicationEnvironmentName,
  type ApplicationReleaseOverview,
  type ApplicationVersionRequirement
} from '@voicechat/shared'
import type { RendererApi } from '@shared/ipc'
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
const empty: ApplicationReleaseOverview = {
  environment: { schemaVersion: 1, revision: 0, applications: [] },
  activeDeploymentId: null,
  releases: [],
  deployments: []
}
export function ApplicationReleaseCenter({
  projectId,
  baseBranch,
  owner,
  api
}: Props): JSX.Element {
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
    [loading, setLoading] = useState(true)
  const generation = useRef(0),
    pending = useRef<{ key: string; id: string } | null>(null)
  const app = catalog.find((item) => item.id === applicationId)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const [apps, data] = await Promise.all([
        api['releases:applicationCatalog']({ projectId }),
        api['releases:applicationOverview']({ projectId, environment })
      ])
      if (request !== generation.current) return
      setCatalog(apps)
      setOverview(data)
      setLoading(false)
    } catch (error) {
      if (request === generation.current) {
        setError(error instanceof Error ? error.message : String(error))
        setLoading(false)
      }
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
  useEffect(() => {
    if (
      !overview.activeDeploymentId &&
      !overview.releases.some((record) => record.status === 'preparing')
    )
      return
    const timer = window.setInterval(() => {
      void refresh()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [overview, refresh])
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
  const deploy = (rollbackOf?: string) =>
    execute(async () => {
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
  return (
    <section
      className="application-release-center"
      aria-label="Релизы приложений"
    >
      <div className="application-release-controls">
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
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Загрузка выпусков…</p>
      ) : (
        <>
          <p>
            Установлено:{' '}
            <strong>
              {installed?.manifest.version ?? 'Нет подтверждённой версии'}
            </strong>
            {installed &&
              ` · API ${installed.manifest.apiVersion} · ${installed.healthy ? 'работает' : 'health-check не пройден'}`}
          </p>
          {installed && (
            <details>
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
            <p>
              У этого приложения пока общий выпуск. Независимый deploy будет
              доступен после завершения его границ.
            </p>
          )}
          {app?.isolation.deploy && owner && (
            <form
              className="application-release-form"
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
                  <p>
                    Укажите проверяемый диапазон зависимостей. Верхняя граница
                    не включается.
                  </p>
                  <div className="application-release-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Зависимость</th>
                          <th>Версия от</th>
                          <th>Версия до</th>
                          <th>API от</th>
                          <th>API до</th>
                        </tr>
                      </thead>
                      <tbody>
                        {app.runtimeDependencies.map((id) => (
                          <tr key={id}>
                            <th>
                              {catalog.find((app) => app.id === id)?.name ?? id}
                            </th>
                            {(
                              [
                                'minVersion',
                                'maxVersionExclusive',
                                'minApiVersion',
                                'maxApiVersionExclusive'
                              ] as const
                            ).map((field) => (
                              <td key={field}>
                                <input
                                  aria-label={`${catalog.find((app) => app.id === id)?.name ?? id}: ${requirementLabels[field]}`}
                                  required
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
              <button className="vc-btn" disabled={busy}>
                Подготовить приложение
              </button>
            </form>
          )}
          <h3>Доступные выпуски</h3>
          <p>
            Для согласованного обновления можно выбрать версии нескольких
            приложений.
          </p>
          {!overview.releases.length ? (
            <p>Подготовленных выпусков пока нет.</p>
          ) : (
            <ul className="application-release-list">
              {overview.releases.map((record) => {
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
                  <li key={record.id}>
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
                      {record.input.applicationId} {record.input.version} ·{' '}
                      {current ? 'Установлен' : status[record.status]}
                    </label>
                    {record.manifest && (
                      <p>
                        {record.manifest.requires
                          .map(
                            (dep) =>
                              `${dep.applicationId} ≥${dep.minVersion} <${dep.maxVersionExclusive}`
                          )
                          .join('; ') || 'Без зависимостей от приложений'}
                      </p>
                    )}
                    <details>
                      <summary>Подготовка и артефакты</summary>
                      <p>
                        {record.branch} · {formatDateTime(record.createdAt)}
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
            <div role="status">
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
            <button
              className="vc-btn"
              disabled={
                busy ||
                !selection.length ||
                !!issues.length ||
                !!overview.activeDeploymentId
              }
              onClick={() => void deploy()}
            >
              Установить выбранные версии
            </button>
          )}
          <h3>История deploy</h3>
          {!overview.deployments.length ? (
            <p>Установок пока нет.</p>
          ) : (
            <ol className="application-release-list">
              {overview.deployments.map((record) => (
                <li key={record.id}>
                  <strong>
                    {record.releases
                      .map((item) => `${item.applicationId} ${item.version}`)
                      .join(', ')}{' '}
                    · {status[record.status]}
                  </strong>
                  <p>
                    {formatDateTime(record.createdAt)}
                    {record.finishedAt
                      ? ` · ${Math.round((record.finishedAt - record.createdAt) / 1000)} с`
                      : ''}
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
    </section>
  )
}
