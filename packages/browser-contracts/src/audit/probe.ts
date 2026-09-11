import { PREVIEW_PROBE_LIMITS } from '@voicechat/shared'

/** Observe a target without attempting the interaction or copying editable content. */
export function previewProbeHelpers(surface: 'proxy' | 'chromium' = 'proxy'): string {
  return String.raw`
const probeLimits=${JSON.stringify(PREVIEW_PROBE_LIMITS)};
const runProbe=action=>{
  const started=performance.now();
  if(typeof action.selector!=='string'||!action.selector.trim()||action.selector.length>probeLimits.selector)throw new Error('Probe requires a selector of 1 to 1000 characters.');
  const matches=bySelector(action.selector);if(matches.length!==1)throw new Error('Probe selector must identify exactly one element; found '+matches.length+'.');
  const el=matches[0],styles=new Map(),style=node=>{if(!styles.has(node))styles.set(node,getComputedStyle(node));return styles.get(node)};
  if(${surface === 'chromium'}){const ref=el.getAttribute('data-voicechat-reader-ref'),references=globalThis.__voicechatReaderReferences;if(ref&&references?.nodes?.get(el)!==ref)throw new Error('stale_element_ref: Find the control again before probing it.')}
  const limitations=['This is a live observation, not a successful interaction or a promise that application JavaScript will accept it.','Pointer samples do not cover every pixel, future animation state, shadow contents or child frames. Coordinates are CSS viewport pixels.'];
  let truncated=false;const limit=message=>{truncated=true;if(!limitations.includes(message))limitations.push(message)};
  const selectorOf=node=>{const value=uniqueSelector(node);if(value.length>probeLimits.sourceSelector)limit('A source selector exceeded 500 characters.');return value.slice(0,probeLimits.sourceSelector)};
  const reasons=[],note=(code,node)=>{if(reasons.some(reason=>reason.code===code))return;if(reasons.length>=probeLimits.reasons){limit('Reason storage stopped at 30 entries.');return}reasons.push({code,...node?{selector:selectorOf(node)}:{}})};
  const ancestors=[];let ancestor=el;for(;ancestor&&ancestors.length<probeLimits.ancestors;ancestor=ancestor.parentElement)ancestors.push(ancestor);
  const incompleteAncestors=!!ancestor;if(incompleteAncestors)limit('Ancestor inspection stopped at 128 elements.');
  const own=style(el),nativeDisabled=el.matches(':disabled');
  const directDisabled='disabled' in el&&el.disabled===true;
  if(directDisabled)note('native-disabled',el);
  const fieldsets=ancestors.filter(node=>node!==el&&node.localName==='fieldset'&&node.disabled);
  const firstLegend=fieldset=>Array.from(fieldset.children).find(node=>node.localName==='legend');
  const fieldsetCause=fieldsets.find(node=>!firstLegend(node)?.contains(el));
  if(nativeDisabled&&fieldsetCause)note('disabled-fieldset',fieldsetCause);
  if(!nativeDisabled&&el.matches('button,input,select,textarea')){const exempt=fieldsets.find(node=>firstLegend(node)?.contains(el));if(exempt)note('first-legend-exemption',firstLegend(exempt))}
  const ariaDisabled=ancestors.find(node=>node.getAttribute('aria-disabled')==='true');if(ariaDisabled)note('aria-disabled-declared',ariaDisabled);
  const modalAncestor=ancestors.find(node=>node.matches('dialog:modal'));
  const inertSource=ancestors.find(node=>node.hasAttribute('inert')&&(!modalAncestor||ancestors.indexOf(node)<=ancestors.indexOf(modalAncestor)));
  const escapedInert=modalAncestor&&ancestors.find(node=>node.hasAttribute('inert')&&ancestors.indexOf(node)>ancestors.indexOf(modalAncestor));
  if(inertSource)note('inert-ancestor',inertSource);if(escapedInert)note('modal-escapes-inert',modalAncestor);
  const modals=Array.from(document.querySelectorAll('dialog:modal'));if(modals.length>probeLimits.modals)limit('Modal inspection reports only the first 16 modal dialogs.');
  const insideModal=modals.some(node=>node.contains(el)),implicitInert=modals.length>0&&!insideModal;
  if(implicitInert)note('modal-background-blocked');
  if(modals.length>1)limitations.push('Multiple modal stacking is resolved by sampled hit testing; DOM order is not top-layer order.');
  const readonlyTypes=['text','search','url','tel','email','password','date','month','week','time','datetime-local','number'];
  const readOnlyApplies=el.localName==='textarea'||el.localName==='input'&&readonlyTypes.includes(el.type);
  const nativeReadOnly=readOnlyApplies&&el.readOnly===true,ignoredReadOnly=el.hasAttribute('readonly')&&!readOnlyApplies;
  if(nativeReadOnly)note('native-readonly',el);if(ignoredReadOnly)note('readonly-attribute-ignored',el);
  const ariaReadOnly=ancestors.find(node=>node.getAttribute('aria-readonly')==='true');if(ariaReadOnly)note('aria-readonly-declared',ariaReadOnly);
  const contentEditable=el.isContentEditable===true,editableSource=ancestors.find(node=>node.hasAttribute('contenteditable'));
  if(contentEditable)note(el.hasAttribute('contenteditable')?'contenteditable':'contenteditable-inherited',editableSource);
  if(!contentEditable&&el.getAttribute('contenteditable')==='false'&&el.parentElement?.isContentEditable)note('contenteditable-false-island',el);
  const displaySource=ancestors.find(node=>style(node).display==='none');if(displaySource)note('display-none',displaySource);
  if(['hidden','collapse'].includes(own.visibility))note('visibility-hidden',el);
  else {const hiddenAncestor=ancestors.slice(1).find(node=>['hidden','collapse'].includes(style(node).visibility));if(hiddenAncestor)note('visibility-overridden',hiddenAncestor)}
  let opacity=1;for(const node of ancestors){const value=Number.parseFloat(style(node).opacity);if(Number.isFinite(value))opacity*=value}
  if(opacity===0)note('transparent-ancestor',ancestors.find(node=>Number.parseFloat(style(node).opacity)===0));else if(opacity<.2)note('low-effective-opacity');
  const contentHidden=ancestors.find(node=>style(node).contentVisibility==='hidden');if(contentHidden)note('content-visibility-hidden',contentHidden);
  const visibleByBrowser=typeof el.checkVisibility==='function'?el.checkVisibility({opacityProperty:true,visibilityProperty:true,contentVisibilityAuto:true}):null;
  if(visibleByBrowser===null)limitations.push('The browser does not expose checkVisibility; rendering visibility is incomplete.');
  if(visibleByBrowser===false&&!contentHidden&&el.checkVisibility({opacityProperty:true,visibilityProperty:true}))note('content-visibility-auto-skipped');
  const closedDetails=ancestors.find(node=>node.localName==='details'&&!node.open);
  if(closedDetails){const summary=Array.from(closedDetails.children).find(node=>node.localName==='summary');note(summary?.contains(el)?'closed-details-summary':'closed-details-content',closedDetails)}
  const closedDialog=ancestors.find(node=>node.localName==='dialog'&&!node.open);if(closedDialog)note('closed-dialog',closedDialog);
  if(own.pointerEvents==='none')note('pointer-events-none',el);
  else {const pointerAncestor=ancestors.slice(1).find(node=>style(node).pointerEvents==='none');if(pointerAncestor)note('pointer-events-restored',pointerAncestor)}
  const hiddenAttribute=ancestors.find(node=>node.hasAttribute('hidden'));if(hiddenAttribute&&visibleByBrowser)note('hidden-attribute-overridden',hiddenAttribute);
  const rawRects=el.getClientRects();if(rawRects.length>probeLimits.rectangles)limit('Geometry inspection stopped at 8 client rectangles.');
  const rects=Array.from({length:Math.min(rawRects.length,probeLimits.rectangles)},(_,i)=>rawRects[i]).filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom}));
  const intersect=(a,b)=>({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
  const nonempty=r=>r.right>r.left&&r.bottom>r.top;
  const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
  const regions=[];
  for(const rect of rects){
    const visible=intersect(rect,viewport);if(!nonempty(visible))continue;regions.push(visible);
    let clipped=visible;
    for(const node of ancestors.slice(1)){const s=style(node),x=/(hidden|clip|scroll|auto)/.test(s.overflowX),y=/(hidden|clip|scroll|auto)/.test(s.overflowY);if(!x&&!y)continue;const r=node.getBoundingClientRect();clipped=intersect(clipped,{left:x?r.left:clipped.left,right:x?r.right:clipped.right,top:y?r.top:clipped.top,bottom:y?r.bottom:clipped.bottom})}
    if(nonempty(clipped)&&Object.keys(clipped).some(key=>clipped[key]!==visible[key]))regions.unshift(clipped);
  }
  const points=[],hitTargets=[];
  for(const r of regions){const dx=Math.min(3,(r.right-r.left)/4),dy=Math.min(3,(r.bottom-r.top)/4);for(const [x,y] of [[(r.left+r.right)/2,(r.top+r.bottom)/2],[r.left+dx,r.top+dy],[r.right-dx,r.top+dy],[r.left+dx,r.bottom-dy],[r.right-dx,r.bottom-dy]]){
    if(points.some(p=>Math.abs(p.x-x)<.1&&Math.abs(p.y-y)<.1))continue;
    if(points.length>=probeLimits.points){limit('Hit testing stopped at 40 sampled points.');break}
    const hit=document.elementFromPoint(x,y),reachesTarget=!!hit&&(hit===el||el.contains(hit));
    let hitIndex=-1;if(hit){let index=hitTargets.findIndex(item=>item.node===hit);if(index<0&&hitTargets.length<probeLimits.hitTargets){index=hitTargets.length;hitTargets.push({node:hit,selector:selectorOf(hit),tag:hit.localName.slice(0,80)})}if(index<0)limit('Hit target storage stopped at 8 elements.');hitIndex=index}
    points.push({x:Math.round(x*100)/100,y:Math.round(y*100)/100,reachesTarget,...hitIndex>=0?{hitIndex}:{}})
  }}
  const reachable=points.some(p=>p.reachesTarget),hasBox=rects.length>0,inViewport=regions.length>0;
  const status=!hasBox?'no-box':visibleByBrowser===false?'hidden':!inViewport?'offscreen':reachable?'reachable':points.length?'blocked':'unknown';
  if(status==='blocked')note('pointer-intercepted');if(status==='offscreen')note('outside-viewport');if(!hasBox)note('no-rendered-box');
  const info=pageInfo();const result={page:{url:info.url.slice(0,4096),title:info.title.slice(0,300)},probe:{version:1,surface:${JSON.stringify(surface)},selector:action.selector,tag:el.localName.slice(0,80),
    visibility:{hasBox,visibleByBrowser,effectiveOpacity:incompleteAncestors?null:Math.round(opacity*10000)/10000,inViewport,rectangles:rects},
    state:{nativeDisabled,ariaDisabled:!!ariaDisabled,inert:inertSource||implicitInert?true:incompleteAncestors||modals.length>1?null:false,nativeReadOnly,ariaReadOnly:!!ariaReadOnly,ignoredReadOnly,contentEditable},
    pointer:{status,points,hitTargets:hitTargets.map(({node,...item})=>item)},reasons,truncated,elapsedMs:Math.round((performance.now()-started)*100)/100,limitations}};
  if(JSON.stringify(result).length>probeLimits.resultJson){for(const reason of reasons)delete reason.selector;limit('Source selectors were omitted to keep the response bounded.');result.probe.truncated=true}
  result.probe.elapsedMs=Math.round((performance.now()-started)*100)/100;
  return result
};
`;
}
