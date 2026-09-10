/** Выполняется внутри context-шима: URL остаются адресами сайта до нативной навигации. */
export function previewNavigationScript(): string {
  return String.raw`
const logicalTarget=(raw)=>{
  const value=raw==null||raw===''?currentBase():String(raw);
  const outer=new URL(value,location.href);
  const target=outer.origin===location.origin&&outer.pathname==='/api/preview'&&outer.searchParams.has('url')
    ?new URL(outer.searchParams.get('url')):new URL(value,documentBase===fallbackBase?currentBase():documentBase);
  if(outer.origin===location.origin&&outer.pathname==='/api/preview'&&outer.hash)target.hash=outer.hash;
  return target;
};
const routeForm=(form,submitter)=>{
  const method=String(submitter&&submitter.hasAttribute('formmethod')?submitter.getAttribute('formmethod'):form.method).toLowerCase();
  if(method==='dialog')return false;
  let target;try{target=logicalTarget(submitter&&submitter.hasAttribute('formaction')?submitter.getAttribute('formaction'):form.getAttribute('action'))}catch{return false}
  if(target.protocol!=='http:'&&target.protocol!=='https:')return false;
  if(method!=='post'){
    const data=new FormData(form,submitter||undefined),query=new URLSearchParams();
    for(const [key,value] of data)query.append(key,typeof value==='string'?value:value.name);
    target.search=query.toString();location.assign(toProxy(target.toString()));return true;
  }
  // Нативная отправка сохраняет enctype, файл и submitter; меняем только маршрут.
  const action=toProxy(target.toString());
  form.setAttribute('action',action);form.setAttribute('target','_self');
  if(submitter){if(submitter.hasAttribute('formaction'))submitter.setAttribute('formaction',action);submitter.setAttribute('formtarget','_self')}
  return false;
};
window.addEventListener('submit',(event)=>{
  if(event.defaultPrevented||!(event.target instanceof HTMLFormElement))return;
  if(routeForm(event.target,event.submitter))event.preventDefault();
});
const nativeFormSubmit=HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit=function(){if(!routeForm(this,null))return nativeFormSubmit.call(this)};
window.addEventListener('click',(event)=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const link=event.composedPath().find(node=>node instanceof Element&&node.matches('a[href],area[href]'));
  if(!link||link.hasAttribute('download'))return;
  const raw=link.getAttribute('href');if(!raw||raw.startsWith('#'))return;
  let target;try{target=logicalTarget(raw)}catch{return}
  if(target.protocol!=='http:'&&target.protocol!=='https:')return;
  link.setAttribute('href',toProxy(target.toString()));link.setAttribute('target','_self');
});
`
}
