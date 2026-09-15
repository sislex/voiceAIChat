// Release Center in every state the improvement cycles touch: the release list
// with a build in progress, the deploy tab with the production marker, a
// running and a failed detail, the empty project and the read-only member. The
// API is the same fake the DOM tests use, so the stories never reach the network.
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import type { RendererApi } from '@shared/ipc'
import { APPLICATION_CATALOG, type ApplicationReleaseManifest, type ApplicationReleaseOverview, type ProjectRelease, type ProjectReleaseSummary, type ReleaseMachine } from '@voicechat/shared'
import { ReleaseCenter } from './ReleaseCenter'

const T0 = Date.UTC(2026, 8, 12, 8, 0)
const machines: ReleaseMachine[] = [
  { agentId: 'mac', name: 'MacBook', ownership: 'mine', access: 'owner', online: true, path: '/Users/dev/ChatAI/worktree', reposRoot: '', eligible: true, unavailableReason: null },
  { agentId: 'prod', name: 'Prod 89.125.68.35', ownership: 'project', access: 'owner', online: true, path: '/root/ChatAI/worktree', reposRoot: '', eligible: true, unavailableReason: null },
  { agentId: 'm1', name: 'MakBook M1 16', ownership: 'project', access: 'owner', online: false, path: '/Users/alex/ChatAI/worktree', reposRoot: '', eligible: false, unavailableReason: 'Машина offline' }
]
const step = (over: Partial<ProjectRelease['steps'][number]>): ProjectRelease['steps'][number] => ({ id: over.kind ?? 'step', kind: 'checkout', status: 'passed', model: null, attempt: 1, log: '', startedAt: T0, finishedAt: T0 + 60_000, limitMs: 600_000, ...over })
const release = (over: Partial<ProjectRelease>): ProjectRelease => ({
  id: over.branch ?? 'release', projectId: 'p1', version: (over.branch ?? 'release/0.1.0').slice('release/'.length), branch: 'release/0.1.0', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', status: 'ready',
  triggeredBy: 'admin', attempt: 1, previousReleaseId: null, createdAt: T0, releasedAt: null, agentId: 'mac', checkoutPath: '/Users/dev/ChatAI/worktree',
  steps: [
    step({ kind: 'checkout', status: 'skipped', startedAt: null, finishedAt: T0, log: 'Checkout уже готов' }),
    step({ kind: 'regression', startedAt: T0, finishedAt: T0 + 180_000, log: '✓ typecheck\n✓ 2878 tests\n✓ web build' }),
    step({ kind: 'knowledge_base', startedAt: T0 + 180_000, finishedAt: T0 + 240_000, log: 'kb:check — актуально' })
  ],
  ...over
})
const ready301 = release({ branch: 'release/0.1.301', id: 'prep-301', createdAt: T0 - 3_600_000 })
const ready300 = release({ branch: 'release/0.1.300', id: 'prep-300', sha: 'e1ca51a304831d24eebd850d6b187dedaa0ed082', createdAt: T0 - 7_200_000 })
const failed299 = release({ branch: 'release/0.1.299', id: 'prep-299', status: 'failed', sha: 'd27bc46cc240ddcd122fd9238bd30e8de039cde0', createdAt: T0 - 10_800_000, steps: [
  step({ kind: 'checkout', status: 'skipped', startedAt: null, finishedAt: T0 }),
  step({ kind: 'regression', status: 'failed', startedAt: T0, finishedAt: T0 + 120_000, log: 'FAIL packages/ui/src/components/kanban/KanbanBoard.dom.test.tsx\n  × перенос карточки клавиатурой\nTests 1 failed | 2877 passed' }),
  step({ kind: 'knowledge_base', status: 'queued', startedAt: null, finishedAt: null })
] })
const building302 = release({ branch: 'release/0.1.302', id: 'prep-302', status: 'checking', sha: '', createdAt: T0 - 60_000, steps: [
  step({ kind: 'checkout', startedAt: T0 - 60_000, finishedAt: T0 - 50_000, log: 'origin/main → release/0.1.302' }),
  step({ kind: 'regression', status: 'running', startedAt: T0 - 50_000, finishedAt: null, log: 'typecheck ✓\nvitest: 1 240 / 2 878…' }),
  step({ kind: 'knowledge_base', status: 'queued', startedAt: null, finishedAt: null })
] })
const deployed301 = release({ branch: 'release/0.1.301', id: 'deploy-301', status: 'released', previousReleaseId: 'prep-301', agentId: 'prod', createdAt: T0 - 1_800_000, releasedAt: T0 - 1_300_000, attempt: 3, steps: [
  step({ kind: 'switching', startedAt: T0 - 1_800_000, finishedAt: T0 - 1_799_000, log: 'checkout → release/0.1.301', limitMs: 120_000 }),
  step({ kind: 'building', startedAt: T0 - 1_799_000, finishedAt: T0 - 1_798_900, log: 'voicechat-deploy запущен', limitMs: 600_000 }),
  step({ kind: 'health_check', startedAt: T0 - 1_798_900, finishedAt: T0 - 1_300_000, log: '{"ok":true,"version":"0.1.301"}', limitMs: 1_800_000 })
] })
const failedDeploy = release({ branch: 'release/0.1.301', id: 'deploy-301-fail', status: 'failed', previousReleaseId: 'prep-301', agentId: 'prod', createdAt: T0 - 3_000_000, attempt: 2, steps: [
  step({ kind: 'switching', startedAt: T0 - 3_000_000, finishedAt: T0 - 2_999_000, limitMs: 120_000 }),
  step({ kind: 'building', startedAt: T0 - 2_999_000, finishedAt: T0 - 2_998_900, limitMs: 600_000 }),
  step({ kind: 'health_check', status: 'failed', startedAt: T0 - 2_998_900, finishedAt: T0 - 1_798_900, log: 'Health-check: фактическая длительность 1200 с, лимит 1200 с. Production отвечает SHA 4b3a3af6, version=0.1.297; ожидаются 13f2651e, version=0.1.301', limitMs: 1_200_000 })
] })
const summary = (item: ProjectRelease, durationMs: number | null = 240_000): ProjectReleaseSummary => {
  const failed = item.steps.find((step) => step.status === 'failed')
  return { id: item.id, branch: item.branch, sha: item.sha, status: item.status, previousReleaseId: item.previousReleaseId, createdAt: item.createdAt, durationMs, attempt: item.attempt, failure: failed ? failed.log.split('\n')[0]!.slice(0, 240) : null }
}

const appManifest = (id: string, version: string): ApplicationReleaseManifest => ({
  schemaVersion: 1, applicationId: id, version, apiVersion: '1.0.0', commit: 'c'.repeat(40), dataVersion: '1.0.0', capabilities: [],
  requires: id === 'make' ? [{ applicationId: 'core', minVersion: '0.1.0', maxVersionExclusive: '1.0.0', minApiVersion: '1.0.0', maxApiVersionExclusive: '2.0.0' }] : [],
  artifacts: [{ service: id === 'core' ? 'voicechat' : id, kind: 'oci', reference: `registry.chat-ai.dev/${id}@sha256:${'d'.repeat(64)}` }]
})
const applicationOverview: ApplicationReleaseOverview = {
  environment: { schemaVersion: 1, revision: 12, applications: [{ manifest: appManifest('core', '0.1.301'), healthy: true, installedAt: T0 - 3_600_000 }, { manifest: appManifest('make', '1.1.0'), healthy: true, installedAt: T0 - 86_400_000 }] },
  activeDeploymentId: null,
  releases: [
    { id: 'app-make-120', projectId: 'p1', input: { applicationId: 'make', version: '1.2.0', image: 'registry.chat-ai.dev/make', baseBranch: 'main', requires: [] }, branch: 'release/make/1.2.0', status: 'ready', manifest: appManifest('make', '1.2.0'), createdAt: T0 - 1_200_000, finishedAt: T0 - 900_000, triggeredBy: 'admin', log: 'gate passed\nimage pushed' },
    { id: 'app-make-110', projectId: 'p1', input: { applicationId: 'make', version: '1.1.0', image: 'registry.chat-ai.dev/make', baseBranch: 'main', requires: [] }, branch: 'release/make/1.1.0', status: 'ready', manifest: appManifest('make', '1.1.0'), createdAt: T0 - 90_000_000, finishedAt: T0 - 89_000_000, triggeredBy: 'admin', log: 'gate passed' },
    { id: 'app-make-130', projectId: 'p1', input: { applicationId: 'make', version: '1.3.0', image: 'registry.chat-ai.dev/make', baseBranch: 'main', requires: [] }, branch: 'release/make/1.3.0', status: 'failed', manifest: null, createdAt: T0 - 600_000, finishedAt: T0 - 500_000, triggeredBy: 'admin', log: 'contract check failed: make-contracts 2.0 требует core API ≥ 2.0.0' }
  ],
  deployments: [
    { id: 'app-deploy-1', projectId: 'p1', environment: 'staging', requestId: 'r1', status: 'released', releases: [appManifest('make', '1.1.0')], previous: { schemaVersion: 1, revision: 11, applications: [{ manifest: appManifest('make', '1.0.0'), healthy: true, installedAt: T0 - 172_800_000 }] }, result: null, rollbackOf: null, createdAt: T0 - 86_400_000, finishedAt: T0 - 86_300_000, triggeredBy: 'admin', log: 'health ok' }
  ]
}

function fakeApi(over: { releases?: ProjectRelease[]; fail?: boolean } = {}): RendererApi {
  const all = over.releases ?? [building302, ready301, ready300, failed299, deployed301, failedDeploy]
  const api = createFakeApi()
  api['releases:applicationCatalog'] = async () => [...APPLICATION_CATALOG]
  api['releases:applicationOverview'] = async () => applicationOverview
  api['releases:machines'] = async () => ({ machines, lastAgentId: 'mac' })
  api['releases:branches'] = async () => all.filter((item) => !item.previousReleaseId && item.sha).map((item) => ({ branch: item.branch, version: item.version, sha: item.sha }))
  api['releases:list'] = async () => { if (over.fail) throw new Error('release service unavailable'); return all.map((item) => summary(item, item.status === 'checking' ? null : 240_000)) }
  api['releases:get'] = async ({ releaseId }) => all.find((item) => item.id === releaseId) ?? null
  api['releases:createBranch'] = async ({ branch }) => release({ branch, id: 'new', status: 'preparing', sha: '', steps: [] })
  api['releases:deploy'] = async ({ branch }) => ({ ...deployed301, id: 'deploy-new', branch, status: 'queued', steps: deployed301.steps.map((item) => ({ ...item, status: 'queued', startedAt: null, finishedAt: null })) })
  api['projects:update'] = async () => ({}) as never
  return api
}

const meta: Meta<typeof ReleaseCenter> = {
  title: 'Releases/ReleaseCenter',
  component: ReleaseCenter,
  args: { projectId: 'p1', baseBranch: 'main', owner: true, gitUrl: 'https://github.com/sislex/voiceAIChat.git', production: { ready: true, mode: 'legacy', missing: [], machineName: 'Prod 89.125.68.35', healthCheckCommand: 'curl -fsS http://127.0.0.1:8787/api/health' }, onOpenSettings: () => undefined, api: fakeApi() },
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="toolpage projpage" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ReleaseCenter>

export const Releases: Story = {}
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } }
export const Dark: Story = { globals: { theme: 'dark' } }
export const Deploy: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('tab', { name: 'Деплой' })) }
}
export const DeployMobile: Story = { ...Deploy, parameters: { viewport: { defaultViewport: 'mobile1' } } }
export const RunningDetail: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByText('release/0.1.302')) }
}
export const FailedDeployDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Деплой' }))
    await userEvent.click((await canvas.findAllByText('release/0.1.301')).at(-1)!)
  }
}
export const Settings: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Настройки' })) }
}
export const Empty: Story = { args: { api: fakeApi({ releases: [] }) } }
export const LoadError: Story = { args: { api: fakeApi({ fail: true }) } }
export const ReadOnly: Story = { args: { owner: false } }
export const Applications: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Приложения' })) }
}
export const ApplicationsMobile: Story = { ...Applications, parameters: { viewport: { defaultViewport: 'mobile1' } } }
export const ProductionNotConfigured: Story = {
  args: { production: { ready: false, mode: 'legacy', missing: ['production-машина', 'команда деплоя'] } },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('tab', { name: 'Деплой' })) }
}
