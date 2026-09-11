/** Contrast estimates explicitly decline complex paint rather than inventing a flat backdrop. */
export function colorAuditRules(): string {
  return String.raw`
const colorClamp=n=>Math.max(0,Math.min(1,n));
const colorComposite=(front,back)=>{const alpha=front[3]+back[3]*(1-front[3]);return alpha?[0,1,2].map(i=>(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/alpha).concat(alpha):[0,0,0,0]};
const colorParse=(value,c)=>{
  const cache=c.colorParseCache||(c.colorParseCache=new Map());if(cache.has(value))return cache.get(value);
  if(!value||!CSS.supports('color',value)||['currentcolor','inherit','initial','unset','revert'].includes(value.toLowerCase()))return null;
  const canvas=c.colorCanvas||(c.colorCanvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1):Object.assign(document.createElement('canvas'),{width:1,height:1}));
  const ctx=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});if(!ctx)return null;
  ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const rgba=Array.from(ctx.getImageData(0,0,1,1).data).map(n=>n/255);cache.set(value,rgba);return rgba
};
const colorLuminance=rgb=>rgb.slice(0,3).map(n=>n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
const colorRatio=(a,b)=>{const x=colorLuminance(a),y=colorLuminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const colorText=(el,c)=>{
  const cache=c.colorTextCache||(c.colorTextCache=new WeakMap());if(cache.has(el))return cache.get(el);
  let found=false,count=0;
  if(!el.matches('script,style,template,noscript,input,textarea,select'))for(const node of el.childNodes){
    if(count++>=256){c.limit('Color text discovery stopped after 256 child nodes on an element.');break}
    if(node.nodeType!==Node.TEXT_NODE)continue;
    const value=node.nodeValue||'';if(value.length>4096)c.limit('Color text discovery inspected only the first 4096 characters of a text node.');
    if(value.slice(0,4096).trim()){found=true;break}
  }
  cache.set(el,found);return found
};
const colorControl='input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select';
const colorEligible=(el,c)=>c.visible(el)&&!el.matches(':disabled')&&!el.closest('[aria-disabled="true"],[inert]');
const colorReference=s=>Number.parseFloat(s.fontSize)>=24||Number.parseFloat(s.fontSize)>=56/3&&Number.parseFloat(s.fontWeight)>=700?3:4.5;
const colorPaint=(el,c,foreground,options={})=>{
  let ink=colorParse(foreground,c),back=[0,0,0,0];if(!ink)return {unknown:'The foreground color could not be resolved to sRGB.'};
  const layers=[];
  if(options.pseudo)layers.push({node:el,style:options.pseudo});
  for(let node=el;node;node=node.parentElement){if(layers.length>=64){c.limit('The paint ancestor scan reached 64 layers.');return {unknown:'The paint ancestor scan reached 64 layers.'}}layers.push({node,style:c.style(node)})}
  for(let i=0;i<layers.length;i++){
    const {node,style:s}=layers[i];
    if(s.mixBlendMode&&s.mixBlendMode!=='normal')return {unknown:'mix-blend-mode changes the foreground/background combination.'};
    if(s.filter&&s.filter!=='none'||s.backdropFilter&&s.backdropFilter!=='none')return {unknown:'A filter or backdrop-filter changes painted colors.'};
    if(i===0&&!options.allowTextEffects&&(s.textShadow&&s.textShadow!=='none'||Number.parseFloat(s.webkitTextStrokeWidth)>0))return {unknown:'Text shadow or stroke affects glyph edge contrast.'};
    const skipBackground=options.outside&&i===0||s.display==='contents'||ink[3]>=1&&back[3]>=1;
    if(!skipBackground&&s.backgroundImage!=='none')return {unknown:'An image or gradient prevents a uniform background estimate.'};
    const background=skipBackground?[0,0,0,0]:colorParse(s.backgroundColor,c);if(!background)return {unknown:'A background color could not be resolved to sRGB.'};
    ink=colorComposite(ink,background);back=colorComposite(back,background);
    const rawOpacity=Number.parseFloat(s.opacity),opacity=Number.isFinite(rawOpacity)?colorClamp(rawOpacity):1;ink[3]*=opacity;back[3]*=opacity;
  }
  if(back[3]<.99999)return {unknown:'The canvas backdrop is transparent or unknown; white cannot be assumed.'};
  return {ratio:colorRatio(ink,back),ink,back}
};
const colorEvidence=(paint,reference)=>'Estimated sRGB contrast '+paint.ratio.toFixed(2)+':1; reference '+reference+':1. Foreground rgb('+paint.ink.slice(0,3).map(n=>Math.round(n*255)).join(',')+'); background rgb('+paint.back.slice(0,3).map(n=>Math.round(n*255)).join(',')+').';
const colorForeground=s=>s.webkitTextFillColor&&s.webkitTextFillColor!=='currentcolor'?s.webkitTextFillColor:s.color;
const colorPseudo=(el,name)=>{const s=getComputedStyle(el,'::'+name);return !['none','normal','""'].includes(s.content)&&s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.content?.startsWith('"')?s:null};
const colorOccluded=(el,c)=>{const r=c.rect(el);if(r.width<=0||r.height<=0)return false;const x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||x>=innerWidth||y<0||y>=innerHeight)return false;const hit=document.elementFromPoint(x,y);return !!hit&&!el.contains(hit)&&!hit.contains(el)};
const colorRule=(id,title,selector,check)=>auditRule('color',id,title,'warning','heuristic',selector,(el,c)=>colorEligible(el,c)?check(el,c):null);
colorRule('text-contrast-low','Configured text contrast is low','*',(el,c)=>{if(!colorText(el,c)&&!el.matches(colorControl)||colorOccluded(el,c))return null;const s=c.style(el),paint=colorPaint(el,c,colorForeground(s)),reference=colorReference(s);return !paint.unknown&&paint.ratio<reference?colorEvidence(paint,reference):null});
colorRule('placeholder-contrast-low','Placeholder contrast is low','input[placeholder],textarea[placeholder]',(el,c)=>{if(!el.matches(':placeholder-shown')||colorOccluded(el,c))return null;const s=getComputedStyle(el,'::placeholder'),paint=colorPaint(el,c,colorForeground(s),{pseudo:s}),reference=colorReference(c.style(el));return !paint.unknown&&paint.ratio<reference?colorEvidence(paint,reference):null});
for(const pseudo of ['before','after'])colorRule(pseudo+'-contrast-low','Generated '+pseudo+' text contrast is low','*',(el,c)=>{const s=colorPseudo(el,pseudo);if(!s||colorOccluded(el,c))return null;const paint=colorPaint(el,c,colorForeground(s),{pseudo:s}),reference=colorReference(s);return !paint.unknown&&paint.ratio<reference?colorEvidence(paint,reference):null});
colorRule('selection-contrast-low','Custom selection colors have low contrast','*',(el,c)=>{if(!colorText(el,c))return null;const s=getComputedStyle(el,'::selection'),bg=colorParse(s.backgroundColor,c);if(!bg||!bg[3])return null;const paint=colorPaint(el,c,s.color,{pseudo:s}),reference=colorReference(c.style(el));return !paint.unknown&&paint.ratio<reference?colorEvidence(paint,reference):null});
colorRule('focus-outline-contrast-low','Current focus outline has low contrast','*',(el,c)=>{if(el!==document.activeElement)return null;const s=c.style(el);if(['none','hidden'].includes(s.outlineStyle)||Number.parseFloat(s.outlineWidth)<=0)return null;const paint=colorPaint(el,c,s.outlineColor,{outside:true,allowTextEffects:true});return !paint.unknown&&paint.ratio<3?colorEvidence(paint,3):null});
colorRule('control-boundary-contrast-low','Control boundary has low contrast',colorControl,(el,c)=>{const s=c.style(el);if(s.backgroundImage!=='none')return null;const fill=colorPaint(el,c,s.backgroundColor,{outside:true,allowTextEffects:true});if(fill.unknown||fill.ratio>=3)return null;let visible=0;for(const side of ['Top','Right','Bottom','Left']){if(['none','hidden'].includes(s['border'+side+'Style'])||Number.parseFloat(s['border'+side+'Width'])<=0)continue;visible++;const paint=colorPaint(el,c,s['border'+side+'Color'],{outside:true,allowTextEffects:true});if(paint.unknown||paint.ratio>=3)return null}return visible?'All rendered border sides and the control fill have estimated contrast below 3:1 against the surrounding background.':null});
colorRule('svg-icon-contrast-low','Named SVG icon has low fill contrast','svg[role="img"] path,svg[role="img"] rect,svg[role="img"] circle',(el,c)=>{if(el.closest('[aria-hidden="true"]')||!accessibleName(el.closest('svg')))return null;const s=c.style(el);if(s.fill==='none')return null;const parsed=colorParse(s.fill==='currentcolor'?s.color:s.fill,c);if(!parsed)return null;const fill=[...parsed];fill[3]*=colorClamp(Number.parseFloat(s.fillOpacity));const value='rgba('+fill.slice(0,3).map(n=>n*255).join(',')+','+fill[3]+')',paint=colorPaint(el,c,value,{allowTextEffects:true});return !paint.unknown&&paint.ratio<3?colorEvidence(paint,3):null});
auditRule('color','color-inspection-incomplete','Contrast needs additional paint evidence','info','observed','*',(el,c)=>{
  if(!colorEligible(el,c))return null;
  const samples=[];
  if(colorText(el,c)||el.matches(colorControl))samples.push({name:'Text',style:c.style(el),options:{}});
  if(colorText(el,c)){const s=getComputedStyle(el,'::selection'),bg=colorParse(s.backgroundColor,c);if(bg&&bg[3])samples.push({name:'Selection',style:s,foreground:s.color,options:{pseudo:s}})}
  if(el.matches('input[placeholder],textarea[placeholder]')&&el.matches(':placeholder-shown')){const s=getComputedStyle(el,'::placeholder');samples.push({name:'Placeholder',style:s,options:{pseudo:s}})}
  for(const name of ['before','after']){const s=colorPseudo(el,name);if(s)samples.push({name:'::'+name,style:s,options:{pseudo:s}})}
  if(!samples.length)return null;
  if(colorOccluded(el,c))return 'The element center is covered by another element; inspect the screenshot and intended layering.';
  for(const sample of samples){const paint=colorPaint(el,c,sample.foreground||colorForeground(sample.style),sample.options);if(paint.unknown)return sample.name+': '+paint.unknown}
  return null
});
`;
}
