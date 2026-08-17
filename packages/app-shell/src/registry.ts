import type{AppCommand,AppModule,LoadedModule,SessionUser}from'./contracts.js'
export interface ResolvedRoute{module:AppModule;route:unknown}
export interface ModuleInstance{module:AppModule;loaded:LoadedModule;store:unknown;route:unknown}
export class ModuleRegistry{
  readonly modules:readonly AppModule[]
  constructor(modules:readonly AppModule[],options:{validate?:boolean}={}){const ids=new Set<string>();for(const module of modules){if(ids.has(module.id))throw new Error(`Duplicate AppModule id "${module.id}"`);ids.add(module.id)}this.modules=[...modules];if(options.validate!==false)this.assertNoRouteConflicts()}
  isVisible(module:AppModule,user:SessionUser|null):boolean{if(module.visible&&!module.visible(user))return false;if(module.roles?.length&&!module.roles.some(role=>user?.role===role||user?.roles?.includes(role)))return false;return true}
  resolve(hash:string,user:SessionUser|null):ResolvedRoute|null{const matches=this.modules.filter(module=>this.isVisible(module,user)).flatMap(module=>{const match=module.routes.parse(hash);return match?[{module,route:match.route}]:[]});if(matches.length>1)throw new Error(`Ambiguous route "${hash}" matched modules: ${matches.map(v=>v.module.id).join(', ')}`);return matches[0]??null}
  build(moduleId:string,route:unknown):string{const module=this.modules.find(item=>item.id===moduleId);if(!module)throw new Error(`Unknown AppModule "${moduleId}"`);return module.routes.build(route)}
  commands(user:SessionUser|null):readonly AppCommand[]{return this.modules.filter(module=>this.isVisible(module,user)).flatMap(module=>module.commands??[]).filter(command=>command.visible())}
  navigation(user:SessionUser|null){return this.modules.filter(module=>this.isVisible(module,user)).flatMap(module=>module.navigation?[module.navigation]:[])}
  private assertNoRouteConflicts():void{const examples=this.modules.flatMap(module=>(module.routes.examples??[]).map(hash=>({module,hash})));for(const{module,hash}of examples){const owners=this.modules.filter(candidate=>candidate.routes.parse(hash));if(owners.length>1)throw new Error(`Route conflict for "${hash}": declared by ${module.id}, matched by ${owners.map(v=>v.id).join(', ')}`)}}
}
