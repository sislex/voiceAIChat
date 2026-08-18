import type{ComponentType,ReactNode}from'react'
export type MaybePromise<T>=T|Promise<T>;export type Cleanup=()=>MaybePromise<void>;export type UserRole='admin'|'user'|string
export interface SessionUser{name:string;role:UserRole;roles?:readonly UserRole[]}
export interface SessionClient{check():Promise<SessionUser|null>;login(credentials:{name:string;password:string}):Promise<SessionUser|null>;logout():Promise<void>}
export interface SettingsSnapshot{user:Readonly<Record<string,unknown>>;capabilities:Readonly<Record<string,unknown>>|null;llmAccess:readonly unknown[];sttCatalog:readonly unknown[];ttsCatalog:readonly unknown[];permissionDefaults:Readonly<Record<string,unknown>>;featureGates:Readonly<Record<string,boolean>>}
export interface SettingsClient{load():Promise<SettingsSnapshot>;save(patch:Readonly<Record<string,unknown>>):Promise<void>}
export interface VoiceClient{stop():MaybePromise<void>;dispose?():MaybePromise<void>}
export interface NavigationItem{id:string;label:string;href:string;icon?:ReactNode;visible?:()=>boolean}
export interface NavigationSlot{id:string;label?:string;items():readonly NavigationItem[];actions?:readonly AppCommand[]}
export interface AppCommand{id:string;label:string;description?:string;keywords?:readonly string[];shortcut?:string;visible:()=>boolean;enabled:()=>boolean;run():MaybePromise<void>}
export interface RouteMatch<R=unknown>{route:R}
export interface ModuleContext{notices:NoticePort;navigate(href:string,options?:{replace?:boolean}):void;registerCleanup(cleanup:Cleanup):()=>void}
export interface LoadedModule<R=unknown,S=unknown>{createStore?(context:ModuleContext):MaybePromise<S>;render:ComponentType<{route:R;store:S|undefined}>;bootstrap?(store:S|undefined,route:R):MaybePromise<void>;dispose?(store:S|undefined):MaybePromise<void>}
export interface AppModule<R=unknown,S=unknown>{id:string;routes:{parse(hash:string):RouteMatch<R>|null;build(route:R):string;examples?:readonly string[]};navigation?:NavigationSlot;commands?:readonly AppCommand[];visible?:(user:SessionUser|null)=>boolean;roles?:readonly UserRole[];load():Promise<LoadedModule<R,S>>}
export interface Notice{id:string;message:string;kind:'info'|'success'|'warning'|'error'}
export interface NoticePort{push(notice:Omit<Notice,'id'>&{id?:string}):string;dismiss(id:string):void}
export interface AppShellHost{platform:'web'|'desktop'|'test'|string;capabilities:Readonly<Record<string,boolean>>;location:{hash():string;subscribe(listener:()=>void):()=>void;navigate(hash:string,replace?:boolean):void};logError(error:unknown,context:{moduleId:string;phase:string}):void}
export interface ApplicationPorts{session?:SessionClient;settings:SettingsClient;voice:VoiceClient;host:AppShellHost;reconnect?:(dispatch:(ownerId:string,event:unknown)=>void)=>Cleanup;cleanup?:readonly Cleanup[]}
