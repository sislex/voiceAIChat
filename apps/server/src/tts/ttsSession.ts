// TTS per-connection: preserves browser FIFO while synthesis is owned by TTS Runner.
import type { ServerMessage } from '@voicechat/shared'
import type { TtsClient } from './client/types.js'

export interface TtsSessionDeps { client:TtsClient;send:(msg:ServerMessage)=>void;ownerId?:string }
export interface TtsSession { speak(text:string,voice:string):void;cancel():void;dispose():void }

export function createTtsSession(deps:TtsSessionDeps):TtsSession {
 let queue:{text:string;voice:string}[]=[];let processing=false;let generation=0;let activeRunId:string|null=null
 async function pump():Promise<void>{
  if(processing)return;processing=true;const gen=generation
  while(queue.length&&gen===generation){
   const item=queue.shift()!
   try{
    const run=await deps.client.create({version:1,text:item.text,voice:item.voice,format:'wav',engine:'auto',...(deps.ownerId?{ownerId:deps.ownerId}:{})})
    activeRunId=run.runId
    const audio=await deps.client.audio(run.runId)
    if(gen!==generation)break
    deps.send({t:'tts.audio',audio:Buffer.from(audio).toString('base64')})
   }catch(err){if(gen!==generation)break;deps.send({t:'tts.error',message:err instanceof Error?err.message:String(err)})}
   finally{activeRunId=null}
  }
  processing=false
 }
 const cancel=()=>{generation++;queue=[];const id=activeRunId;activeRunId=null;if(id)void deps.client.cancel(id);processing=false}
 return {speak(text,voice){queue.push({text,voice});void pump()},cancel,dispose:cancel}
}
