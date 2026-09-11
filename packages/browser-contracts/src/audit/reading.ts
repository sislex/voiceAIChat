/** Share semantic reading so audit names agree across both Reader engines. */
export function previewReadingHelpers(): string {
 return String.raw`const readingVisible=el=>actionVisible(el)&&!el.closest('[data-voicechat-inspector],[inert]')&&el.id!=='voicechat-preview-inspector';
const accessibleVisible=el=>readingVisible(el)&&!el.closest('[aria-hidden="true"]');
const readableText=(el,limit=SNIPPET,hidden=false)=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),parts=[];let size=0,node;
  while((node=walker.nextNode())&&size<limit){const parent=node.parentElement;if(!parent||parent.closest('script,style,template,noscript,[data-voicechat-inspector]')||!hidden&&!readingVisible(parent))continue;if(parent.closest('textarea')&&sensitive(parent.closest('textarea')))continue;const text=(node.nodeValue||'').replace(/\s+/g,' ').trim();if(text){parts.push(text);size+=text.length+1}}
  return parts.join(' ').slice(0,limit)
};
const accessibleName=(el,seen=new Set())=>{
  if(seen.has(el))return '';seen.add(el);
  const ids=(el.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean);
  if(ids.length){const names=ids.map(id=>{const ref=document.getElementById(id);return ref&&!seen.has(ref)?readableText(ref,EL_TEXT,true):''}).filter(Boolean);if(names.length)return names.join(' ').slice(0,EL_TEXT)}
  const aria=el.getAttribute('aria-label');if(aria&&aria.trim())return aria.trim().slice(0,EL_TEXT);
  if(el.labels&&el.labels.length){const label=[...el.labels].map(label=>readableText(label,EL_TEXT,true)).filter(Boolean).join(' ');if(label)return label.slice(0,EL_TEXT)}
  if(el.localName==='img'||el.localName==='input'&&el.type==='image')return (el.getAttribute('alt')||el.getAttribute('title')||'').slice(0,EL_TEXT);
  if(el.localName==='input'&&['submit','reset','button'].includes(el.type))return (el.value||el.getAttribute('title')||'').slice(0,EL_TEXT);
  const text=readableText(el,EL_TEXT);if(text)return text;
  const image=el.querySelector('img[alt]');if(image&&image.alt)return image.alt.slice(0,EL_TEXT);
  return (el.getAttribute('title')||el.getAttribute('placeholder')||el.name||'').slice(0,EL_TEXT)
};
const accessibleRole=el=>{
  const explicit=(el.getAttribute('role')||'').trim().split(/\s+/).find(role=>['button','link','tab','menuitem','checkbox','radio','textbox','searchbox','combobox','listbox','option','slider','spinbutton','switch','heading','dialog','alert','status','navigation','main','banner','contentinfo','form','table','row','cell','columnheader','rowheader','list','listitem','img','region','group','tree','treeitem','progressbar','separator','none','presentation'].includes(role));
  if(explicit)return ['none','presentation'].includes(explicit)?'':explicit;
  const tag=el.localName;
  if(tag==='a')return el.hasAttribute('href')?'link':'';
  if(tag==='input'){const type=el.type||'text';if(type==='hidden')return '';if(['checkbox','radio'].includes(type))return type;if(['submit','button','reset','image'].includes(type))return 'button';if(type==='range')return 'slider';if(type==='number')return 'spinbutton';if(type==='search')return 'searchbox';return 'textbox'}
  if(tag==='select')return el.multiple||el.size>1?'listbox':'combobox';
  if(/^h[1-6]$/.test(tag))return 'heading';
  return ({button:'button',summary:'button',textarea:'textbox',option:'option',img:'img',nav:'navigation',main:'main',header:'banner',footer:'contentinfo',form:'form',table:'table',tr:'row',td:'cell',th:el.scope==='row'?'rowheader':'columnheader',ul:'list',ol:'list',li:'listitem',dialog:'dialog',progress:'progressbar',hr:'separator'})[tag]||''
};
const controlState=el=>{
 const state={};if(el.matches(':disabled')||el.closest('[aria-disabled="true"],[inert]'))state.disabled=true;
 if(el.readOnly||el.getAttribute('aria-readonly')==='true')state.readOnly=true;
 for(const [attr,key] of [['aria-checked','checked'],['aria-expanded','expanded'],['aria-selected','selected'],['aria-required','required'],['aria-invalid','invalid']]){const value=el.getAttribute(attr);if(value!==null)state[key]=value==='mixed'&&key==='checked'?'mixed':value!=='false'}
 if(el.localName==='input'&&['checkbox','radio'].includes(el.type))state.checked=el.indeterminate?'mixed':el.checked;
 if(el.localName==='option')state.selected=el.selected;if(el.required)state.required=true;
 return state
};
const readingScope=action=>action.selector?chooseTarget(action):(document.body||document.documentElement);
const scopeElements=(scope,selector)=>[...(scope.matches(selector)?[scope]:[]),...scope.querySelectorAll(selector)].filter(readingVisible);
`;
}
