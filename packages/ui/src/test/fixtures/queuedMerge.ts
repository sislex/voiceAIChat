import type { MergeRun, MergeMachinesResponse } from '@shared/merge'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'

export const queuedMergeRun: MergeRun = {
  id: 'queued-475', projectId: 'p1', taskId: 't1', status: 'queued', stage: 'queued',
  triggeredBy: 'owner', sourceBranch: 'CHAT-475', targetBranch: 'main',
  sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40), mergeSha: null, revertSha: null,
  agentId: 'machine-a', machineName: 'MacBook A', assignmentVersion: 0,
  llmEngineId: null, llmProvider: 'codex', llmModel: '', stages: [], conflicts: [],
  conflictDetails: [], checks: [], deployId: null, deployVersion: null, productionStatus: null,
  error: null, recommendedAction: null, log: 'Existing merge history', canCancel: true, canRetry: false,
  pushStartedAt: null, startedAt: null, finishedAt: null, createdAt: 1_700_000_000_000
}
export const queuedMergeMachines: MergeMachinesResponse = {
  defaultAgentId: 'machine-a',
  machines: [
    { agentId: 'machine-a', name: 'MacBook A', readiness: { ready: true, selectable: true, mode: 'managed', code: 'ready', message: 'Готово' } },
    { agentId: 'machine-b', name: 'MacBook B — длинное имя машины проекта', readiness: { ready: true, selectable: true, mode: 'managed', code: 'ready', message: 'Готово' } },
    { agentId: 'offline', name: 'Offline', readiness: { ready: false, selectable: false, mode: null, code: 'machine_offline', message: 'Машина не в сети' } }
  ]
}
export function queuedMergeCi() {
  const ci = createFakeCi()
  let current = { ...queuedMergeRun }
  ci.getTaskMachines = async () => ({ machines: queuedMergeMachines.machines.map(machine => ({
    agentId: machine.agentId, name: machine.name, online: machine.readiness.ready, personal: false, project: true, projectDefault: false
  })), selectedAgentId: current.agentId, unavailableSelection: null })
  ci.getMergeMachines = async () => structuredClone(queuedMergeMachines)
  ci.getMerge = async () => current
  ci.listMergeRuns = async () => [current]
  ci.getTaskRepositories = async () => []
  ci.changeMergeMachine = async (_id, input) => {
    current = { ...current, agentId: input.agentId, machineName: queuedMergeMachines.machines.find(machine => machine.agentId === input.agentId)!.name,
      assignmentVersion: (current.assignmentVersion ?? 0) + 1 }
    return { ok: true, run: current }
  }
  return ci
}
