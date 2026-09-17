import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { TemporaryResources } from './TemporaryResources'
import { MergePanel } from './MergePanel'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import type { CleanupSnapshot, TemporaryResource } from '@shared/temporaryResources'
const previous=window.board
afterEach(()=>{window.board=previous})
const resource:TemporaryResource={id:'r',projectId:'p',taskId:'t',runId:'run',userId:'u',machineId:'m',machineName:'MacBook',path:'/owned/resource',root:'/owned',category:'merge-worktree',generation:'g',identity:'1:2',gitCommonDir:null,gitRegistration:null,createdAt:1,state:'registered'}
const snapshot:CleanupSnapshot={
  candidates:[{resource,eligible:false,reasons:['machine_offline','git_changes'],retainUntil:2000,bytes:null,sizeReason:'machine_offline'}],
  attempts:[{id:'a',resource,at:1000,outcome:'partial',reason:'permission_denied',error:'Access denied',freedBytes:null}]
}
// @testCase TC-04
// @testCase TC-08
it('opens read-only preview inside MergePanel with reasons, unknown sizes, owner and journal',async()=>{
  window.ci={...createFakeCi(),getTemporaryResources:vi.fn(async()=>snapshot)}
  render(<MergePanel projectId="p" taskId="t" runId={null} canStart={false}/>)
  expect(window.ci.getTemporaryResources).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Временные ресурсы и журнал'}))
  expect(await screen.findByText('Размер неизвестен')).toBeInTheDocument()
  expect(screen.getAllByText('/owned/resource')).toHaveLength(2)
  expect(screen.getByText(/Есть несохранённые изменения/)).toBeInTheDocument()
  expect(screen.getByText(/Частично выполнено/)).toBeInTheDocument()
  expect(screen.getByText('Освобождено: неизвестно')).toBeInTheDocument()
  expect(screen.getByText(/Результаты запусков остаются в истории/)).toBeInTheDocument()
  expect(window.ci.getTemporaryResources).toHaveBeenCalledOnce()
  expect(window.ci.getTemporaryResources).toHaveBeenCalledWith('p','t')
})
// @testCase TC-04
// @testCase TC-08
it('distinguishes loading, empty, failure and retry, and refreshes after reconnect',async()=>{
  let resolve!:(value:CleanupSnapshot)=>void
  let reconnect=()=>{}
  window.board={...previous,onReconnect:(cb:()=>void)=>{reconnect=cb;return()=>{}},onTaskRepositoriesUpdated:()=>()=>{}} as typeof window.board
  const read=vi.fn<()=>Promise<CleanupSnapshot>>().mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({candidates:[],attempts:[]})
  window.ci={...createFakeCi(),getTemporaryResources:read}
  render(<TemporaryResources projectId="p" taskId="t"/>)
  expect(screen.getByRole('region',{name:'Временные ресурсы'})).toHaveAttribute('aria-busy','true')
  resolve({candidates:[],attempts:[]})
  expect(await screen.findByText('Нет временных ресурсов для очистки')).toBeInTheDocument()
  reconnect()
  expect(await screen.findByText(/Не удалось загрузить ресурсы: offline/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:/Повторить/}))
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(3))
  await waitFor(()=>expect(screen.queryByText(/Не удалось загрузить ресурсы/)).not.toBeInTheDocument())
})
