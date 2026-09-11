/** Focus checks observe a snapshot; actual keyboard paths require scenario execution. */
export function focusAuditRules(): string {
  return String.raw`
const focusAuditRule=(id,title,selector,check)=>auditRule('focus',id,title,'warning','heuristic',selector,check);
const focusAuditAttribute=(el,name,c)=>{const value=el.getAttribute(name);if(value!==null&&value.length>1024){c.limit('Focus metadata inspection stopped at 1024 attribute characters.');return undefined}return value};
const focusAuditRendered=(el,c)=>typeof el.checkVisibility==='function'?el.checkVisibility({opacityProperty:false,visibilityProperty:true,contentVisibilityAuto:true}):c.visible(el);
const focusAuditScope=el=>el.closest('dialog,[popover]')||document.documentElement;
const focusAuditPending=el=>{const scope=focusAuditScope(el);return scope.localName==='dialog'&&!scope.open||scope.hasAttribute('popover')&&!scope.matches(':popover-open')};
const focusAuditInactive=(el,c)=>{
  if(!c.focusAuditModal){const present=!!document.querySelector('dialog:modal'),active=document.activeElement?.closest('dialog:modal');c.focusAuditModal={present,active};if(present&&!active)c.limit('The active native modal focus scope could not be resolved; keyboard entry comparisons are incomplete.')}
  const modal=c.focusAuditModal,declared=el.closest('[inert]');
  return el.matches(':disabled')||!!declared&&(!modal.active||modal.active.contains(declared))||modal.present&&!modal.active?.contains(el)||!focusAuditRendered(el,c);
};
const focusAuditEditingHost=el=>el.isContentEditable&&!el.parentElement?.isContentEditable;
const focusAuditNative=el=>el.matches('button,input:not([type="hidden"]),select,textarea,a[href],area[href],iframe,object,embed,dialog')||el.localName==='summary'&&el.tabIndex>=0||focusAuditEditingHost(el);
const focusAuditEntry=(el,c)=>!focusAuditInactive(el,c)&&(el.tabIndex>=0||focusAuditEditingHost(el)&&!el.hasAttribute('tabindex'));
const focusAuditComposite=el=>el.parentElement?.closest('[role="grid"],[role="treegrid"],[role="tree"],[role="listbox"],[role="menu"],[role="menubar"],[role="tablist"],[role="radiogroup"],[role="toolbar"]');
const focusAuditActive=el=>el===document.activeElement&&!el.matches('html,body,iframe')&&!el.shadowRoot?.activeElement;
const focusAuditTransparent=value=>value==='transparent'||/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value)||/\/\s*0(?:\.0+)?\s*\)$/.test(value);
focusAuditRule('tabindex-syntax-invalid','Tabindex does not contain a whole integer spelling','[tabindex]',(el,c)=>{const value=focusAuditAttribute(el,'tabindex',c);return value!==undefined&&!/^[\t\n\f\r ]*[+-]?\d+[\t\n\f\r ]*$/.test(value)?'Tabindex has non-integer syntax; the browser currently reflects '+el.tabIndex+'. Native parsing may accept a numeric prefix.':null});
focusAuditRule('dialog-tabindex-declared','Dialog declares tabindex','dialog[tabindex]',()=> 'The dialog element must not declare tabindex; inspect focus placement on its content instead.');
focusAuditRule('autofocus-conflict','Autofocus declarations share one scope','[autofocus]',(el,c)=>{
  const cache=c.focusAutofocusCounts||(c.focusAutofocusCounts=new Map());if(!c.focusAutofocusCounted){for(const node of c.all('[autofocus]')){const scope=focusAuditScope(node);cache.set(scope,(cache.get(scope)||0)+1)}c.focusAutofocusCounted=true}
  return cache.get(focusAuditScope(el))>1?'More than one autofocus declaration shares the same document, dialog or popover scope.':null;
});
focusAuditRule('autofocus-disabled','Autofocus target is natively disabled','[autofocus]',el=>el.matches(':disabled')?'This autofocus target is currently disabled, including native fieldset inheritance.':null);
focusAuditRule('autofocus-not-visible','Autofocus target is currently hidden','[autofocus]',(el,c)=>!focusAuditPending(el)&&!focusAuditRendered(el,c)?'Autofocus targets content not currently rendered in an active scope; review when it becomes focusable.':null);
focusAuditRule('autofocus-no-focus-target','Autofocus has no known focusable target','[autofocus]',(el,c)=>{
  if(focusAuditPending(el)||focusAuditInactive(el,c)||el.localName.includes('-')||el.shadowRoot)return null;
  const value=focusAuditAttribute(el,'tabindex',c);if(value===undefined)return null;
  return !focusAuditNative(el)&&el.tabIndex<0&&!(value!==null&&/^[\t\n\f\r ]*[+-]?\d+/.test(value))?'The autofocus target has no native focus behavior or numeric tabindex; browser and scripted focus rules need review.':null;
});
focusAuditRule('custom-widget-no-tab-entry','Standalone widget has no apparent Tab entry','[role]',(el,c)=>{
  const role=(focusAuditAttribute(el,'role',c)||'').trim().split(/\s+/)[0];
  return ['button','link','checkbox','switch','slider','spinbutton','textbox','combobox'].includes(role)&&!focusAuditComposite(el)&&!focusAuditInactive(el,c)&&el.getAttribute('aria-disabled')!=='true'&&!focusAuditEntry(el,c)?'Standalone widget has no apparent sequential keyboard entry; shortcuts or delegated focus management may provide an alternative.':null;
});
focusAuditRule('native-control-negative-tabindex','Standalone control is removed from sequential focus','button[tabindex],input[tabindex],select[tabindex],textarea[tabindex],a[href][tabindex]',(el,c)=>el.tabIndex<0&&!el.matches('input[type="radio"],input[type="hidden"]')&&!focusAuditComposite(el)&&!focusAuditInactive(el,c)?'A standalone native control explicitly has negative tabindex; verify an equivalent keyboard path.':null);
focusAuditRule('inline-click-no-tab-entry','Inline click target has no apparent keyboard entry','[onclick]',(el,c)=>!focusAuditInactive(el,c)&&!focusAuditEntry(el,c)&&typeof el.onclick==='function'?'An inline click target has no apparent Tab entry; delegated keyboard handlers are not inspected.':null);
focusAuditRule('scroll-region-negative-tabindex','Scrollable region excludes its own keyboard entry','[tabindex]',(el,c)=>{
  if(el.tabIndex>=0||focusAuditInactive(el,c))return null;const style=c.style(el),scrolls=['auto','scroll'].includes(style.overflowY)&&el.scrollHeight>el.clientHeight+2||['auto','scroll'].includes(style.overflowX)&&el.scrollWidth>el.clientWidth+2;
  if(!scrolls)return null;return !c.all('*').some(child=>child!==el&&el.contains(child)&&focusAuditEntry(child,c))?'Scrollable region has negative tabindex and no observed child keyboard entry; verify keyboard scrolling.':null;
});
for(const [attribute,keywords] of [['inputmode',['none','text','decimal','numeric','tel','search','email','url']],['enterkeyhint',['enter','done','go','next','previous','search','send']]])focusAuditRule(attribute+'-keyword-invalid','Invalid '+attribute+' keyboard hint','['+attribute+']',(el,c)=>{const value=focusAuditAttribute(el,attribute,c);return value&&!keywords.includes(value.toLowerCase())?'The '+attribute+' attribute contains an unknown keyword; inspect the keyboard hint fallback.':null});
const focusAuditKeys=(el,c)=>{const value=focusAuditAttribute(el,'accesskey',c);return value===undefined?null:(value||'').split(/[\t\n\f\r ]+/).filter(Boolean)};
focusAuditRule('accesskey-token-invalid','Accesskey has invalid or repeated tokens','[accesskey]',(el,c)=>{const keys=focusAuditKeys(el,c);return keys&&(keys.some(key=>[...key].length!==1)||new Set(keys).size!==keys.length)?'Accesskey must be a unique space-separated list of one-code-point tokens.':null});
focusAuditRule('accesskey-candidate-conflict','Controls declare the same accesskey candidate','[accesskey]',(el,c)=>{
  if(focusAuditInactive(el,c))return null;
  if(!c.focusAccessKeyCounts){c.focusAccessKeyCounts=new Map();for(const node of c.all('[accesskey]'))if(!focusAuditInactive(node,c))for(const key of new Set(focusAuditKeys(node,c)||[]))if([...key].length===1)c.focusAccessKeyCounts.set(key,(c.focusAccessKeyCounts.get(key)||0)+1)}
  return (focusAuditKeys(el,c)||[]).some(key=>c.focusAccessKeyCounts.get(key)>1)?'Multiple active controls declare an identical accesskey candidate; actual assigned shortcuts depend on browser and platform.':null;
});
focusAuditRule('focus-paint-needs-review','Current focus has no computed outline or shadow','*',(el,c)=>{if(!focusAuditActive(el)||!el.matches(':focus-visible'))return null;const style=c.style(el);return (style.outlineStyle==='none'||Number.parseFloat(style.outlineWidth)===0)&&style.boxShadow==='none'?'Current focus-visible styling has no computed outline or shadow; borders, backgrounds or other indicators may still be valid. Review pixels.':null});
focusAuditRule('focus-outline-transparent','Current focus outline is transparent','*',(el,c)=>{if(!focusAuditActive(el)||!el.matches(':focus-visible'))return null;const style=c.style(el);return style.outlineStyle!=='none'&&Number.parseFloat(style.outlineWidth)>0&&focusAuditTransparent(style.outlineColor)?'The current focus outline is transparent; inspect alternative focus indicators.':null});
focusAuditRule('focused-caret-transparent','Focused editor has a transparent caret','input,textarea,[contenteditable]',(el,c)=>{
  const textControl=el.localName==='textarea'||el.localName==='input'&&['text','search','url','tel','email','password','number'].includes(el.type);
  return focusAuditActive(el)&&(textControl&&!el.readOnly||el.isContentEditable)&&focusAuditTransparent(c.style(el).caretColor)?'The focused editable control has transparent caret-color; custom caret rendering may provide an alternative.':null;
});
focusAuditRule('focused-opacity-zero','Current focus is fully transparent','*',(el,c)=>{
  if(!focusAuditActive(el))return null;let count=0;
  for(let node=el;node;node=node.parentElement){if(count++>=128){c.limit('Focus opacity inspection stopped at 128 ancestors.');break}if(Number.parseFloat(c.style(node).opacity)===0)return 'The currently focused target has a fully transparent opacity layer.'}return null;
});
focusAuditRule('focused-outside-viewport','Current focus is outside the viewport','*',(el,c)=>{if(!focusAuditActive(el))return null;const r=c.rect(el);return r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight?'The focused element is entirely outside the current viewport; verify how keyboard users can reveal it.':null});
focusAuditRule('focused-zero-size','Current focus has a zero-size box','*',(el,c)=>{if(!focusAuditActive(el))return null;const r=c.rect(el);return r.width===0||r.height===0?'The focused target has zero width or height; inspect its focus indication and usable geometry.':null});
const focusAuditOrder=(el,c,kind)=>{
  const style=c.style(el);if(!(kind==='flex'?['flex','inline-flex']:['grid','inline-grid']).includes(style.display)||style.writingMode!=='horizontal-tb'||style.readingFlow&&style.readingFlow!=='normal')return null;
  const children=[];let count=0;
  for(const child of el.children){if(count++>=100){c.limit('Focus order inspection stopped at 100 direct children.');break}if(focusAuditEntry(child,c)){if(child.matches('input[type="radio"]')){c.limit('Focus order estimates exclude native radio-group traversal; run a keyboard scenario.');return null}children.push(child)}}
  children.sort((a,b)=>(a.tabIndex>0?a.tabIndex:Infinity)-(b.tabIndex>0?b.tabIndex:Infinity));
  const rtl=style.direction==='rtl';for(let i=1;i<children.length;i++){const a=c.rect(children[i-1]),b=c.rect(children[i]);if(b.top<a.top-2||Math.abs(a.top-b.top)<=2&&(rtl?b.right>a.right+2:b.left<a.left-2))return 'Focusable '+kind+' children reverse their estimated keyboard sequence in visual geometry; inspect actual Tab order. Modern reading-flow layouts are excluded.'}return null;
};
focusAuditRule('focus-flex-order-reversed','Focusable flex items reverse visual order','*',(el,c)=>focusAuditOrder(el,c,'flex'));
focusAuditRule('focus-grid-order-reversed','Focusable grid items reverse visual order','*',(el,c)=>focusAuditOrder(el,c,'grid'));
focusAuditRule('focused-aria-hidden','Current focus has an aria-hidden ancestor','*',el=>focusAuditActive(el)&&el.closest('[aria-hidden="true"]')?'Current focus is below an aria-hidden declaration; the browser may ignore the declaration to retain accessible focus.':null);
const focusAuditDescendant=(el,c)=>{const id=focusAuditAttribute(el,'aria-activedescendant',c);return id?document.getElementById(id):null};
focusAuditRule('active-descendant-missing','Focused widget references a missing active descendant','[aria-activedescendant]',(el,c)=>focusAuditActive(el)&&focusAuditAttribute(el,'aria-activedescendant',c)&&!focusAuditDescendant(el,c)?'The focused widget references an active descendant that does not resolve in this document.':null);
focusAuditRule('active-descendant-hidden','Focused widget references a hidden active descendant','[aria-activedescendant]',(el,c)=>{if(!focusAuditActive(el))return null;const target=focusAuditDescendant(el,c);return target&&!c.visible(target)?'The focused widget references an active descendant hidden by computed visibility or display.':null});
focusAuditRule('active-descendant-unrelated','Active descendant has no observed ownership relation','[aria-activedescendant]',(el,c)=>{
  if(!focusAuditActive(el))return null;const target=focusAuditDescendant(el,c);if(!target||el.contains(target))return null;
  const attributes=['aria-owns','aria-controls'].map(name=>focusAuditAttribute(el,name,c));if(attributes.includes(undefined))return null;
  const ids=attributes.flatMap(value=>(value||'').split(/\s+/).filter(Boolean));if(ids.length>64){c.limit('Focus relationship inspection stopped at 64 ID references.');return null}
  return ids.some(id=>document.getElementById(id)?.contains(target))?null:'Active descendant is outside the focused widget and its observed aria-owns/aria-controls subtrees; inspect the widget relationship.';
});
`;
}
