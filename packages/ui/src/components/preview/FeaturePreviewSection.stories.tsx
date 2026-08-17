import type { Meta, StoryObj } from '@storybook/react'
import type { PreviewEnvironment, PreviewState } from '@shared/preview'
import { FeaturePreviewSection } from './FeaturePreviewSection'

const makeEnvironment = (state: PreviewState, patch: Partial<PreviewEnvironment> = {}): PreviewEnvironment => ({
  id: 'preview-163', projectId: 'p1', taskId: 't1', agentId: 'MacBook',
  workspacePath: '/repos/chat/163', branch: 'feature/163', expectedCommitSha: 'a1b2c3d4e5f6', builtCommitSha: 'a1b2c3d4e5f6',
  currentCommitSha: 'a1b2c3d4e5f6', gitStatus: 'verified', state, staleReason: null, composeProject: 'vc-preview-p1-t1',
  appUrl: 'https://preview.example.test/app', storybookUrl: 'https://preview.example.test/storybook/',
  storybookStatus: 'ready', storybookCommitSha: 'a1b2c3d4e5f6', selectedSeedScenario: 'basic-user',
  seedVersion: 'v1', dataReady: true, healthStatus: state === 'running' || state === 'stale' ? 'healthy' : 'unknown',
  services: [], runs: [{ id: 'run1', environmentId: 'preview-163', operation: 'start', status: 'succeeded',
    initiator: 'alexey', createdAt: Date.now() - 30_000, startedAt: Date.now() - 30_000, finishedAt: Date.now(),
    agentId: 'MacBook', workspacePath: '/repos/chat/163', configurationKey: 'start:MacBook:/repos/chat/163:a1b2c3d4e5f6',
    commitSha: 'a1b2c3d4e5f6', version: 2, currentStepId: null, steps: [], events: [],
    errorType: null, errorMessage: null, exitCode: 0, log: 'build complete\nhealth check passed\n', result: null }],
  createdBy: 'alexey', createdAt: Date.now() - 60_000, updatedAt: Date.now(), startedAt: Date.now(),
  stoppedAt: null, lastError: null, ...patch
})

function PreviewStory({ environment }: { environment: PreviewEnvironment | null }): JSX.Element {
  window.featurePreview = {
    get: async () => environment,
    operate: async () => environment ?? makeEnvironment('building'),
    cancel: async () => true,
    open: async () => ({ connectionType: 'direct', state: 'connected', url: environment?.appUrl ?? null, tunnelId: null, manualCommand: null, internalUrl: environment?.appUrl ?? '', localAgentId: null, error: null }),
    closeTunnel: async () => true
  }
  return <div style={{ width: 420 }}><FeaturePreviewSection projectId="p1" taskId="t1" /></div>
}

const meta = { title: 'Kanban/FeaturePreview', component: PreviewStory } satisfies Meta<typeof PreviewStory>
export default meta
type Story = StoryObj<typeof meta>

export const NotCreated: Story = { args: { environment: null } }
export const Building: Story = { args: { environment: makeEnvironment('building') } }
export const Running: Story = { args: { environment: makeEnvironment('running') } }
export const Stale: Story = { args: { environment: makeEnvironment('stale', { currentCommitSha: 'ffffffffffff', staleReason: 'commit_changed' }) } }
export const StorybookError: Story = { args: { environment: makeEnvironment('failed', { storybookStatus: 'failed', lastError: { type: 'storybook', message: 'Storybook build failed' } }) } }
export const Seed: Story = { args: { environment: makeEnvironment('seeding', { selectedSeedScenario: 'project-with-tasks' }) } }
export const Cleanup: Story = { args: { environment: makeEnvironment('cleaning') } }
