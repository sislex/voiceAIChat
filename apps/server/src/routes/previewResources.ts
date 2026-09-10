/** Синхронная перепись нужна до DOM-вставки: MutationObserver срабатывает уже после начала запроса. */
export function previewResourceScript(): string {
  return String.raw`const nativeGetAttribute=Element.prototype.getAttribute,nativeSetAttribute=Element.prototype.setAttribute,nativeGetAttributeNS=Element.prototype.getAttributeNS,nativeSetAttributeNS=Element.prototype.setAttributeNS;
const resourceBase=()=>documentBase===fallbackBase?currentBase():documentBase;
const fromResourceProxy=(value)=>{if(value==null||String(value).startsWith('#'))return value;try{const u=new URL(String(value),location.href);if(u.origin===location.origin&&u.pathname==='/api/preview'&&u.searchParams.has('url'))return u.searchParams.get('url')+(!u.searchParams.get('url').includes('#')?u.hash:'')}catch{}return value};
const resourceAttribute=(el,name)=>{
  const tag=el.localName,nameLower=String(name).toLowerCase().replace(/^xlink:/,'');
  return nameLower==='src'&&['img','script','iframe','audio','video','source','track','embed','input'].includes(tag)||nameLower==='href'&&['a','area','link','image','use'].includes(tag)||nameLower==='poster'&&tag==='video'||nameLower==='data'&&tag==='object'||nameLower==='action'&&tag==='form'||nameLower==='formaction'&&['button','input'].includes(tag)
};
const resourceSrcset=(source,convert)=>{
  let position=0,copied=0,result='';source=String(source);const space=char=>/[\t\n\f\r ]/.test(char);
  while(position<source.length){while(position<source.length&&(space(source[position])||source[position]===','))position++;const start=position;while(position<source.length&&!space(source[position]))position++;let end=position;while(end>start&&source[end-1]===',')end--;if(end>start){result+=source.slice(copied,start)+convert(source.slice(start,end));copied=end}if(end<position)continue;let depth=0;while(position<source.length){const char=source[position++];if(char==='(')depth++;else if(char===')')depth=Math.max(0,depth-1);else if(char===','&&!depth)break}}
  return result+source.slice(copied)
};
const resourceValue=(el,name,value)=>{
  name=String(name).toLowerCase();value=String(value);
  if((name==='srcset'&&['img','source'].includes(el.localName))||(name==='imagesrcset'&&el.localName==='link'))return resourceSrcset(value,toProxy);
  if(resourceAttribute(el,name))return value.trim().startsWith('#')?value:toProxy(value);
  if(name==='target'&&['_blank','_parent','_top'].includes(value.toLowerCase()))return '_self';
  return value
};
const resourceIntegrity=(el,name)=>String(name).toLowerCase()==='integrity'&&['script','link'].includes(el.localName);
Element.prototype.setAttribute=function(name,value){if(resourceIntegrity(this,name)){this.removeAttribute('integrity');return}return nativeSetAttribute.call(this,name,resourceValue(this,name,value))};
Element.prototype.setAttributeNS=function(ns,name,value){if(resourceIntegrity(this,name)){this.removeAttribute('integrity');return}return nativeSetAttributeNS.call(this,ns,name,resourceValue(this,name,value))};
Element.prototype.getAttribute=function(name){const value=nativeGetAttribute.call(this,name);if(value===null)return null;return resourceAttribute(this,name)?fromResourceProxy(value):/^(?:srcset|imagesrcset)$/i.test(name)?resourceSrcset(value,fromResourceProxy):value};
Element.prototype.getAttributeNS=function(ns,name){const value=nativeGetAttributeNS.call(this,ns,name);return resourceAttribute(this,name)?fromResourceProxy(value):value};
for(const [className,properties] of [
  ['HTMLImageElement',['src','srcset']],['HTMLScriptElement',['src']],['HTMLLinkElement',['href','imageSrcset']],['HTMLIFrameElement',['src']],
  ['HTMLMediaElement',['src']],['HTMLVideoElement',['poster']],['HTMLSourceElement',['src','srcset']],['HTMLTrackElement',['src']],
  ['HTMLEmbedElement',['src']],['HTMLObjectElement',['data']],['HTMLInputElement',['src','formAction']],['HTMLButtonElement',['formAction']],
  ['HTMLFormElement',['action']],['HTMLAnchorElement',['href']],['HTMLAreaElement',['href']]
])for(const property of properties)try{
  const proto=window[className]&&window[className].prototype,descriptor=proto&&Object.getOwnPropertyDescriptor(proto,property);
  if(!descriptor||!descriptor.set||!descriptor.get||!descriptor.configurable)continue;
  Object.defineProperty(proto,property,{...descriptor,get(){const value=descriptor.get.call(this);return /srcset$/i.test(property)?resourceSrcset(value,fromResourceProxy):fromResourceProxy(value)},set(value){return descriptor.set.call(this,resourceValue(this,property.toLowerCase(),value))}})
}catch{}
for(const className of ['HTMLScriptElement','HTMLLinkElement'])try{const proto=window[className].prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'integrity');if(descriptor&&descriptor.configurable)Object.defineProperty(proto,'integrity',{...descriptor,set(){this.removeAttribute('integrity')}})}catch{}
const innerDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
const rewriteDynamicMarkup=(source)=>{
  if(typeof source!=='string'||!innerDescriptor||!innerDescriptor.set||!innerDescriptor.get)return source;
  const template=document.createElement('template');innerDescriptor.set.call(template,source);
  const visit=root=>{for(const el of root.querySelectorAll('*')){if(el.localName==='base'){el.remove();continue}for(const attr of [...el.attributes]){if(resourceIntegrity(el,attr.name)){el.removeAttribute(attr.name);continue}const value=resourceValue(el,attr.name,attr.value);if(value!==attr.value){if(attr.namespaceURI)nativeSetAttributeNS.call(el,attr.namespaceURI,attr.name,value);else nativeSetAttribute.call(el,attr.name,value)}}if(el.localName==='template')visit(el.content)}};
  visit(template.content);return innerDescriptor.get.call(template)
};
for(const [proto,property] of [[Element.prototype,'innerHTML'],[Element.prototype,'outerHTML'],[window.ShadowRoot&&ShadowRoot.prototype,'innerHTML']])try{const descriptor=proto&&Object.getOwnPropertyDescriptor(proto,property);if(descriptor&&descriptor.set&&descriptor.configurable)Object.defineProperty(proto,property,{...descriptor,set(value){return descriptor.set.call(this,rewriteDynamicMarkup(value))}})}catch{}
const adjacent=Element.prototype.insertAdjacentHTML;Element.prototype.insertAdjacentHTML=function(position,html){return adjacent.call(this,position,rewriteDynamicMarkup(html))};
try{Object.defineProperty(document,'URL',{configurable:true,get:currentBase});Object.defineProperty(document,'documentURI',{configurable:true,get:currentBase});Object.defineProperty(document,'baseURI',{configurable:true,get:resourceBase});Object.defineProperty(document,'referrer',{configurable:true,get:()=>''})}catch{}
`;
}
