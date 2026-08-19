import type { Conversation } from '@shared/types'
import type { PreviewActionResult } from '@shared/previewActions'
import type { ReaderChatPort, WebReaderHostPort, WebRecorderPort } from './contracts'

export const isWebReaderConversation=(c:Conversation):boolean=>c.assistantKind==='web-recorder'||(c.assistantKind==null&&Boolean(c.previewUrl))
export interface WebReaderState{status:'idle'|'loading'|'ready'|'error';conversations:readonly Conversation[];activeId:string|null;previewUrl:string|null;mobilePane:'chat'|'browser';recorder:'unavailable'|'loading'|'ready';error:string|null}
export interface WebReaderStore{getState():Readonly<WebReaderState>;subscribe(fn:()=>void):()=>void;load():Promise<void>;activate(id:string|null):Promise<void>;setMobilePane(pane:'chat'|'browser'):void;dispose():void}
export function createWebReaderStore(chat:ReaderChatPort,host:WebReaderHostPort):WebReaderStore{
 let state:WebReaderState={status:'idle',conversations:[],activeId:null,previewUrl:null,mobilePane:'chat',recorder:'unavailable',error:null},generation=0,recorder:WebRecorderPort|null=null,disposed=false
 const listeners=new Set<()=>void>(),emit=(patch:Partial<WebReaderState>)=>{if(disposed)return;state={...state,...patch};listeners.forEach(fn=>fn())}
 const stop=()=>{recorder?.dispose();recorder=null}
 const load=async()=>{const token=++generation;emit({status:'loading',error:null});try{const all=await chat.list();if(token!==generation||disposed)return;emit({status:'ready',conversations:all.filter(isWebReaderConversation)})}catch{if(token===generation)emit({status:'error',error:'Не удалось загрузить разговоры'})}}
 const activate=async(id:string|null)=>{const token=++generation;stop();emit({activeId:id,previewUrl:null,recorder:'unavailable'});if(!id)return;const conversation=await chat.get(id);if(token!==generation||disposed)return;if(!conversation||!isWebReaderConversation(conversation)){emit({error:'Разговор Web Reader не найден'});return}const fallback=conversation.projectId?await host.projectPreviewUrl(conversation.projectId):null;if(token!==generation||disposed)return;emit({previewUrl:conversation.previewUrl??fallback});recorder=host.recorder(id);recorder.subscribe(value=>emit({recorder:value.ready?'ready':value.page==='loading'?'loading':'unavailable',error:value.error??null}));recorder.setUrl(conversation.previewUrl??fallback)}
 const offRelay=host.relay.subscribe(request=>{if(disposed||request.conversationId!==state.activeId||!recorder)return;const active=request.conversationId;void recorder.run(request.requestId,request.action).then((result:PreviewActionResult)=>{if(!disposed&&state.activeId===active)host.relay.result(active,request.requestId,result)})})
 return{getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},load,activate,setMobilePane:pane=>emit({mobilePane:pane}),dispose(){if(disposed)return;disposed=true;generation++;stop();offRelay();listeners.clear()}}
}
