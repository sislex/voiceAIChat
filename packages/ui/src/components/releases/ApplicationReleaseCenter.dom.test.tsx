// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import {
  APPLICATION_CATALOG,
  type ApplicationReleaseManifest,
  type ApplicationReleaseOverview
} from '@voicechat/shared'
import { ApplicationReleaseCenter } from './ApplicationReleaseCenter'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
afterEach(cleanup)
const manifest = (
  id = 'make',
  version = '1.1.0'
): ApplicationReleaseManifest => ({
  schemaVersion: 1,
  applicationId: id,
  version,
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  capabilities: [],
  requires:
    id === 'make'
      ? [
          {
            applicationId: 'core',
            minVersion: '1.0.0',
            maxVersionExclusive: '2.0.0',
            minApiVersion: '1.0.0',
            maxApiVersionExclusive: '2.0.0'
          }
        ]
      : [],
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference: `registry.test/${id}@sha256:${'b'.repeat(64)}`
    }
  ]
})
function setup(coreVersion = '1.0.0', owner = true) {
  const api = createFakeApi(),
    m = manifest()
  const overview: ApplicationReleaseOverview = {
    environment: {
      schemaVersion: 1,
      revision: 4,
      applications: [
        {
          manifest: manifest('core', coreVersion),
          healthy: true,
          installedAt: 1
        }
      ]
    },
    activeDeploymentId: null,
    releases: [
      {
        id: 'release-1',
        projectId: 'p1',
        input: {
          applicationId: 'make',
          version: m.version,
          image: 'registry.test/make',
          baseBranch: 'main',
          requires: m.requires
        },
        branch: 'release/make/1.1.0',
        status: 'ready',
        manifest: m,
        createdAt: 1,
        finishedAt: 2,
        triggeredBy: 'admin',
        log: 'gate passed'
      }
    ],
    deployments: []
  }
  api['releases:applicationCatalog'] = vi.fn(async () => [
    ...APPLICATION_CATALOG
  ])
  api['releases:applicationOverview'] = vi.fn(async () => overview)
  api['releases:applicationDeploy'] = vi.fn(async ({ input, environment }) => ({
    id: 'deploy-1',
    projectId: 'p1',
    environment,
    requestId: input.requestId,
    status: 'deploying' as const,
    releases: [m],
    previous: overview.environment,
    result: null,
    rollbackOf: null,
    createdAt: 1,
    finishedAt: null,
    triggeredBy: 'admin',
    log: ''
  }))
  render(
    <ApplicationReleaseCenter
      projectId="p1"
      baseBranch="main"
      owner={owner}
      api={api}
    />
  )
  return { api, overview }
}
describe('релизы отдельных приложений', () => {
  it('показывает требования и передаёт выбранный выпуск с ревизией окружения', async () => {
    const { api } = setup()
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)
    expect(
      screen.getByText('Выбранный состав совместим с окружением.')
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Установить выбранные версии' })
    )
    await waitFor(() =>
      expect(api['releases:applicationDeploy']).toHaveBeenCalledWith({
        projectId: 'p1',
        environment: 'staging',
        input: {
          releaseIds: ['release-1'],
          expectedRevision: 4,
          requestId: expect.any(String)
        }
      })
    )
  })
  it('блокирует установку при несовместимой версии ядра', async () => {
    const { api } = setup('2.0.0')
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(screen.getByText(/core 2.0.0: требуется/)).toBeTruthy()
    const button = screen.getByRole('button', {
      name: 'Установить выбранные версии'
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api['releases:applicationDeploy']).not.toHaveBeenCalled()
  })
  it('наблюдателю доступны версии, но не подготовка и deploy', async () => {
    setup('1.0.0', false)
    await screen.findByRole('checkbox')
    expect(
      screen.queryByRole('button', { name: 'Подготовить приложение' })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Установить выбранные версии' })
    ).toBeNull()
  })
  it('сохраняет ключ запроса для повтора после сетевой ошибки', async () => {
    const { api } = setup()
    const deploy = vi
      .fn()
      .mockRejectedValueOnce(new Error('Ответ потерян'))
      .mockResolvedValueOnce({})
    api['releases:applicationDeploy'] = deploy
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Установить выбранные версии' })
    )
    await screen.findByText('Ответ потерян')
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Установить выбранные версии'
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Установить выбранные версии' })
    )
    await waitFor(() => expect(deploy).toHaveBeenCalledTimes(2))
    expect(deploy.mock.calls[0][0].input.requestId).toBe(
      deploy.mock.calls[1][0].input.requestId
    )
  })
  it('смена окружения очищает выбор и не переносит staging-план в production', async () => {
    const { api } = setup()
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Окружение' }), {
      target: { value: 'production' }
    })
    await waitFor(() =>
      expect(api['releases:applicationOverview']).toHaveBeenCalledWith({
        projectId: 'p1',
        environment: 'production'
      })
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Установить выбранные версии'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })
})
