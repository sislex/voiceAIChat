import type { Conversation } from '@shared/types'
export interface ReaderChatPort{list():Promise<readonly Conversation[]>;get(id:string):Promise<Conversation|null>;create(kind:'playwright-reader'):Promise<Conversation>;remove(id:string):Promise<void>;render(conversationId:string|null):import('react').ReactNode;subscribe(listener:()=>void):()=>void}
export interface BrowserCapabilities{chromium:boolean;navigate:boolean;screencast:boolean}
export interface BrowserSessionState{status:'idle'|'starting'|'connected'|'stopped'|'error';url:string|null;capabilities:BrowserCapabilities;error?:string}
export interface BrowserSessionPort{start(conversationId:string):Promise<void>;getState():BrowserSessionState;navigate(url:string):Promise<void>;stop():Promise<void>;subscribe(listener:(state:BrowserSessionState)=>void):()=>void;dispose():void}
export interface PlaywrightReaderHostPort{session(conversationId:string):BrowserSessionPort;fallback?:import('react').ReactNode}
