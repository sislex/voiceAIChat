import { PREVIEW_AUDIT_LIMITS } from '@voicechat/shared'
import { markupAuditRules } from './markup.js'
import { layoutAuditRules } from './layout.js'
import { typographyAuditRules } from './typography.js'

/** The injected runtime must stay self-contained and explicitly report incomplete coverage. */
export function previewAuditHelpers(surface: 'proxy' | 'chromium' = 'proxy'): string {
  return String.raw`
const auditLimits=${JSON.stringify(PREVIEW_AUDIT_LIMITS)};
const auditRules=[];
const auditRule=(group,id,title,severity,confidence,selector,check)=>auditRules.push({group,id,title,severity,confidence,selector,check});
${markupAuditRules()}
${layoutAuditRules()}
${typographyAuditRules()}
const auditMetadata=({group,id,title,severity,confidence})=>({group,id,title,severity,confidence});
const runAudit=action=>{
  const started=performance.now(),group=action.group||'markup',mode=action.mode||'run';
  const rules=auditRules.filter(rule=>rule.group===group);
  const groups=[...new Set(auditRules.map(rule=>rule.group))];
  if(!rules.length)throw new Error('Unknown audit group: '+group+'. Available groups: '+groups.join(', '));
  if(!['run','list'].includes(mode))throw new Error('Unknown audit mode.');
  const offset=action.offset===undefined?0:action.offset,limit=action.limit===undefined?20:action.limit;
  if(!Number.isInteger(offset)||offset<0||offset>auditLimits.findings||!Number.isInteger(limit)||limit<1||limit>auditLimits.limit)throw new Error('Invalid audit pagination.');
  if(action.rules!==undefined&&(!Array.isArray(action.rules)||!action.rules.length||action.rules.length>auditLimits.rules||new Set(action.rules).size!==action.rules.length||action.rules.some(id=>!rules.some(rule=>rule.id===id))))throw new Error('Unknown or invalid audit rule selection. Use audit mode:list.');
  const selected=action.rules?rules.filter(rule=>action.rules.includes(rule.id)):rules;
  const limitations=[${JSON.stringify(surface === 'proxy' ? 'Checks observe the rewritten proxy document, not the original browser origin.' : 'Checks observe the current native Chromium document at its browser origin.')},'Shadow root contents and child frame documents are not scanned.','Heuristic findings require visual review; an empty report is not a complete QA pass.'];
  const info=pageInfo(),page={url:info.url.slice(0,4096),title:info.title.slice(0,300)};
  if(group==='typography')limitations.push('Text checks inspect up to 4096 direct text characters and 256 child nodes per element; descendants are checked separately. Font status inspects up to 1000 declared faces; font stacks up to 4096 characters.');
  let scope=document.documentElement;
  if(action.selector!==undefined){
    if(typeof action.selector!=='string'||!action.selector.trim()||action.selector.length>auditLimits.selector)throw new Error('Invalid audit scope selector.');
    const matches=bySelector(action.selector);if(matches.length!==1)throw new Error('Audit scope must identify exactly one element; found '+matches.length+'.');scope=matches[0];
  }
  const audit={version:1,group,groups,mode,surface:${JSON.stringify(surface)},scope:action.selector||'document',findings:[],rules:[],total:0,checkedRules:0,scannedElements:0,truncated:false,elapsedMs:0,limitations};
  if(mode==='list'){audit.rules=selected.slice(offset,offset+limit).map(auditMetadata);audit.total=selected.length;if(offset+audit.rules.length<selected.length)audit.nextOffset=offset+audit.rules.length;return {page,audit}}
  const nodes=[],walker=document.createTreeWalker(scope,NodeFilter.SHOW_ELEMENT,{acceptNode:node=>node.closest('[data-voicechat-inspector]')||node.id==='voicechat-preview-inspector'?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  if(!scope.closest('[data-voicechat-inspector]'))nodes.push(scope);
  let node;while(nodes.length<auditLimits.elements&&(node=walker.nextNode()))nodes.push(node);
  if(nodes.length===auditLimits.elements&&walker.nextNode()){audit.truncated=true;limitations.push('Element scan stopped at '+auditLimits.elements+' nodes; unscanned content may contain more findings.')}
  audit.scannedElements=nodes.length;
  const matchesCache=new Map(),visibleCache=new WeakMap(),styleCache=new WeakMap(),rectCache=new WeakMap();
  const context={all:selector=>{if(!matchesCache.has(selector))matchesCache.set(selector,nodes.filter(el=>el.matches(selector)));return matchesCache.get(selector)},visible:el=>{if(!visibleCache.has(el))visibleCache.set(el,actionVisible(el));return visibleCache.get(el)},style:el=>{if(!styleCache.has(el))styleCache.set(el,getComputedStyle(el));return styleCache.get(el)},rect:el=>{if(!rectCache.has(el))rectCache.set(el,el.getBoundingClientRect());return rectCache.get(el)}};
  context.limit=message=>{audit.truncated=true;if(!limitations.includes(message))limitations.push(message)};
  const findings=[];
  for(const rule of selected){
    if(rule.selector==='@document'&&scope!==document.documentElement){limitations.push(rule.id+' requires document scope.');continue}
    audit.checkedRules++;
    const targets=rule.selector==='@document'?[scope]:context.all(rule.selector);
    for(const el of targets){
      const evidence=rule.check(el,context);if(!evidence)continue;
      if(findings.length>=auditLimits.findings){audit.truncated=true;break}
      const selector=uniqueSelector(el);findings.push({...auditMetadata(rule),selector:selector.slice(0,auditLimits.selector),evidence:String(evidence).slice(0,auditLimits.evidence)});
      if(selector.length>auditLimits.selector)limitations.push('A finding selector was truncated; narrow the audit scope before using it.');
    }
  }
  audit.total=findings.length;audit.findings=findings.slice(offset,offset+limit);
  if(audit.truncated&&findings.length>=auditLimits.findings)limitations.push('Finding storage stopped at '+auditLimits.findings+'; narrow scope or rules to continue.');
  audit.limitations=[...new Set(limitations)];
  while(audit.findings.length&&JSON.stringify({page,audit}).length>26000)audit.findings.pop();
  if(offset+audit.findings.length<findings.length)audit.nextOffset=offset+audit.findings.length;
  audit.elapsedMs=Math.round((performance.now()-started)*100)/100;
  return {page,audit}
};
`;
}
