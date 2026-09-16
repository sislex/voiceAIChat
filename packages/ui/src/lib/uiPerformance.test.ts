import { expect, it, vi } from 'vitest'
import { UiPerformance } from './uiPerformance'
import { UI_PERFORMANCE_POLICY as P } from '@shared/uiPerformance'
function fixture() {
  let now = 10, visible = true, online = true
  const send = vi.fn(async () => {})
  const p = new UiPerformance({ now:()=>now, visible:()=>visible, online:()=>online, send, id:()=> 'a'.repeat(32),platform:'desktop',version:'1.2.3' })
  return { p,send,time:(n:number)=>{now=n},visible:(v:boolean)=>{visible=v},online:(v:boolean)=>{online=v} }
}
// @testCase T1
// @testCase T2
it('keeps queued acceptance time and cancels only the failed operation', async () => {
  const f=fixture()
  f.p.beginMessage(false,'first'); f.time(15);f.p.beginMessage(true,'queued')
  f.time(20); f.p.mark('message','message_first_token')
  f.p.cancelMessage('queued')
  f.time(25);f.p.beginMessage(true,'second')
  f.p.finish('message','chat');f.time(40);f.p.activateMessage()
  f.p.mark('message','message_first_token');f.p.finish('message','chat')
  await f.p.flush()
  const samples=(f.send.mock.calls as unknown as Array<[{samples:Array<{duration:number;lifecycle:string}>}]>)[0]![0].samples
  expect(samples.map(s=>s.duration)).toEqual([10,15])
  expect(samples.map(s=>s.lifecycle)).toEqual(['cold','warm'])
})
// @testCase T1
it('measures all six event spans in monotonic milliseconds and distinguishes cold/warm per screen', async () => {
  const f = fixture()
  for (const metric of P.metrics) {
    const route = metric === 'shell_interactive' ? 'shell' : metric === 'account_ready' ? 'account' : metric === 'board_ready' ? 'board' : 'chat'
    f.time(10); f.p.begin(metric); f.time(60); f.p.mark(metric,metric); f.time(70); f.p.mark(metric,metric); f.p.finish(metric,route)
    f.time(100); f.p.begin(metric); f.time(120); f.p.mark(metric,metric); f.p.finish(metric,route)
  }
  await f.p.flush()
  const samples = (f.send.mock.calls as unknown as Array<[{samples:Array<{duration:number;lifecycle:string}>}]>)[0]![0].samples
  expect(samples).toHaveLength(12)
  expect(samples.map(s=>s.duration)).toEqual([50,20,50,20,50,20,50,20,50,20,50,20])
  expect(samples.map(s=>s.lifecycle)).toEqual(Array.from({length:6},()=>['cold','warm']).flat())
})
// @testCase T2
it('excludes cancellation after token, background, missing audio and expired offline observations', async () => {
  const f=fixture()
  f.p.begin('message'); f.time(20); f.p.mark('message','message_first_token'); f.p.cancel('message'); f.p.finish('message','chat')
  f.p.begin('route'); f.p.mark('route','chat_ready'); f.visible(false); f.p.hidden(); f.visible(true); f.p.finish('route','chat')
  f.p.begin('message'); f.p.finish('message','chat')
  await f.p.flush(); expect(f.send).not.toHaveBeenCalled()
  f.p.begin('route'); f.time(30); f.p.mark('route','chat_ready'); f.p.finish('route','chat')
  f.online(false); await f.p.flush(); expect(f.send).not.toHaveBeenCalled()
  f.time(400000); f.online(true); await f.p.flush(); expect(f.send).not.toHaveBeenCalled()
})
// @testCase T2
it('ignores wall-clock changes and bounds failed delivery without retry storms', async () => {
  const f=fixture()
  const date=vi.spyOn(Date,'now').mockReturnValue(-99999)
  try {
    for(let i=0;i<100;i++){ f.time(i*10); f.p.begin('route'); f.time(i*10+5); f.p.mark('route','chat_ready'); f.p.finish('route','chat') }
    f.send.mockRejectedValueOnce(new Error('private transport detail'))
    await expect(f.p.flush()).resolves.toBeUndefined()
    await f.p.flush()
    expect(f.send).toHaveBeenCalledTimes(1)
    expect((f.send.mock.calls as unknown as Array<[{samples:unknown[]}]>)[0]![0].samples).toHaveLength(32)
  } finally { date.mockRestore() }
})
