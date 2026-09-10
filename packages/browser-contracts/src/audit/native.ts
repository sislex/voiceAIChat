import { isPreviewAuditOptions, type PreviewAuditOptions } from '@voicechat/shared'
import { previewAuditHelpers } from './runtime.js'
import { previewReadingHelpers } from './reading.js'

/** Generate only trusted built-in checks; model-supplied evaluate code uses its separate policy. */
export function nativeAuditExpression(options: PreviewAuditOptions): string {
  if (!isPreviewAuditOptions(options)) throw new Error('Invalid audit options.')
  const { group, selector, rules, mode, offset, limit } = options
  return String.raw`(()=>{
const EL_TEXT=200,SNIPPET=4000;
const pageInfo=()=>({url:location.href,title:document.title});
const sensitive=el=>['input','textarea'].includes(el.localName)&&(el.type==='password'||el.autocomplete==='current-password'||el.autocomplete==='new-password'||/pass|secret|token|card|cvv/i.test((el.name||'')+' '+(el.id||'')));
const actionVisible=el=>{
  if(!el.isConnected||['script','style','template','noscript'].includes(el.localName))return false;
  for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number.parseFloat(style.opacity)===0)return false}
  return true
};
const bySelector=selector=>Array.from(document.querySelectorAll(selector)).filter(el=>!el.closest('[data-voicechat-inspector]'));
const uniqueSelector=el=>{
  if(el.id){const selector='#'+CSS.escape(el.id);if(document.querySelectorAll(selector).length===1)return selector}
  const parts=[];
  for(let node=el;node&&parts.length<64;node=node.parentElement){
    let part=node.localName;if(node.id)part+='#'+CSS.escape(node.id);
    if(node.parentElement){const siblings=Array.from(node.parentElement.children).filter(other=>other.localName===node.localName);if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(node)+1)+')'}
    parts.unshift(part);const selector=parts.join(' > ');if(document.querySelectorAll(selector).length===1)return selector
  }
  return parts.join(' > ')
};
${previewReadingHelpers()}
${previewAuditHelpers('chromium')}
return runAudit(${JSON.stringify({ group, selector, rules, mode, offset, limit })});
})()`
}
