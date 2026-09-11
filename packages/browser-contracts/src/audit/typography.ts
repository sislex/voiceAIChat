/** Text checks report measurable rendering candidates without copying page text or field values. */
export function typographyAuditRules(): string {
  return String.raw`
const typographyText=(el,c)=>{
  const cache=c.typographyTextCache||(c.typographyTextCache=new WeakMap());if(cache.has(el))return cache.get(el);
  let text='',count=0;
  if(!el.matches('script,style,template,noscript,input,textarea,select'))for(const node of el.childNodes){
    if(count++>=256){c.limit('Text scan stopped at 256 child nodes on an element.');break}
    if(node.nodeType===Node.TEXT_NODE){const value=node.nodeValue||'',room=4096-text.length;text+=value.slice(0,room);if(value.length>room){c.limit('Text scan stopped at 4096 direct characters on an element.');break}}
    if(text.length>=4096){if(node.nextSibling)c.limit('Text scan stopped at 4096 direct characters on an element.');break}
  }
  cache.set(el,text);return text
};
const typographyRule=(id,title,check)=>auditRule('typography',id,title,'warning','heuristic','*',(el,c)=>c.visible(el)&&typographyText(el,c).trim()?check(el,c,typographyText(el,c),c.style(el)):null);
const typographyPixels=value=>Number.parseFloat(value)||0;
const typographyProse=text=>text.trim().length>=120;
const typographyHasGeneric=(value,c)=>{
  if(value.length>4096){c.limit('Font stack inspection stopped at 4096 characters.');return null}
  const families=[];let token='',quote='',escaped=false,depth=0;
  for(const char of value.toLowerCase()){
    if(escaped){token+=char;escaped=false;continue}
    if(char==='\\'){token+=char;escaped=true;continue}
    if(quote){token+=char;if(char===quote)quote='';continue}
    if(char==='"'||char==="'"){quote=char;token+=char;continue}
    if(char==='(')depth++;if(char===')')depth=Math.max(0,depth-1);
    if(char===','&&depth===0){families.push(token.trim());token=''}else token+=char;
  }
  families.push(token.trim());
  return families.some(family=>!['"',"'"].includes(family[0])&&(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','math','fangsong'].includes(family)||/^generic\(\s*(fangsong|kai|khmer-mul|nastaliq)\s*\)$/.test(family)))
};
typographyRule('small-font-text','Text uses a very small font',(el,c,text,s)=>typographyPixels(s.fontSize)>0&&typographyPixels(s.fontSize)<10?'Computed font-size is '+s.fontSize+'; review readability at the current zoom.':null);
typographyRule('zero-font-text','Text has zero font size',(el,c,text,s)=>typographyPixels(s.fontSize)===0?'Computed font-size is zero despite a nonempty text node.':null);
typographyRule('zero-line-height','Text has zero line height',(el,c,text,s)=>s.lineHeight!=='normal'&&typographyPixels(s.lineHeight)===0?'Computed line-height is zero despite a nonempty text node.':null);
typographyRule('tight-line-height','Line height is smaller than the font size',(el,c,text,s)=>typographyPixels(s.lineHeight)>0&&typographyPixels(s.lineHeight)<typographyPixels(s.fontSize)*.9?'line-height='+s.lineHeight+'; font-size='+s.fontSize+'.':null);
typographyRule('tight-letter-spacing','Negative letter spacing may collide glyphs',(el,c,text,s)=>typographyPixels(s.letterSpacing)<-typographyPixels(s.fontSize)*.08?'letter-spacing='+s.letterSpacing+'; font-size='+s.fontSize+'.':null);
typographyRule('tight-word-spacing','Negative word spacing compresses word boundaries',(el,c,text,s)=>/\S\s+\S/.test(text)&&typographyPixels(s.wordSpacing)<-typographyPixels(s.fontSize)*.15?'word-spacing='+s.wordSpacing+'; review separation between words.':null);
typographyRule('transparent-text','Text fill is transparent',(el,c,text,s)=>{const transparent=value=>value==='transparent'||/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value)||/\/\s*0(?:\.0+)?\s*\)$/.test(value);return s.backgroundClip!=='text'&&s.webkitBackgroundClip!=='text'&&(transparent(s.color)||transparent(s.webkitTextFillColor))?'Computed text color or text-fill-color is transparent without background-clip:text.':null});
typographyRule('nowrap-text-overflow','Unwrapped text exceeds its box',(el,c,text,s)=>['nowrap','pre'].includes(s.whiteSpace)&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+2?'white-space='+s.whiteSpace+'; text width exceeds the box by '+(el.scrollWidth-el.clientWidth)+'px.':null);
typographyRule('ellipsis-truncates-text','Ellipsis hides part of the text',(el,c,text,s)=>s.textOverflow==='ellipsis'&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+2?'Text is ellipsized; review whether its full meaning is available when needed.':null);
typographyRule('line-clamp-truncates-text','Line clamp hides additional text',(el,c,text,s)=>Number(s.webkitLineClamp)>0&&el.scrollHeight>el.clientHeight+2?'line-clamp='+s.webkitLineClamp+'; scrollHeight='+el.scrollHeight+'px; clientHeight='+el.clientHeight+'px.':null);
typographyRule('uppercase-long-passage','Long passage is transformed to uppercase',(el,c,text,s)=>typographyProse(text)&&s.textTransform==='uppercase'?'A passage of at least 120 characters uses text-transform:uppercase.':null);
typographyRule('capitalize-long-passage','Long passage capitalizes every word',(el,c,text,s)=>typographyProse(text)&&s.textTransform==='capitalize'?'A passage of at least 120 characters uses text-transform:capitalize.':null);
typographyRule('wide-text-measure','Prose has a very wide line measure',(el,c,text,s)=>typographyProse(text)&&['p','li','blockquote'].includes(el.localName)&&el.clientWidth>typographyPixels(s.fontSize)*60?'Text box width='+el.clientWidth+'px; font-size='+s.fontSize+'; review long lines.':null);
typographyRule('narrow-text-measure','Prose is squeezed into a narrow column',(el,c,text,s)=>typographyProse(text)&&['p','li','blockquote'].includes(el.localName)&&el.clientWidth>0&&el.clientWidth<typographyPixels(s.fontSize)*8?'Text box width='+el.clientWidth+'px; font-size='+s.fontSize+'; review frequent wrapping.':null);
typographyRule('justified-narrow-prose','Narrow justified prose may create large word gaps',(el,c,text,s)=>typographyProse(text)&&s.textAlign==='justify'&&el.clientWidth<typographyPixels(s.fontSize)*20?'Justified text box is narrower than 20em; inspect word spacing.':null);
typographyRule('font-generic-fallback-missing','Font stack has no generic fallback',(el,c,text,s)=>typographyHasGeneric(s.fontFamily,c)===false?'Font stack has no unquoted generic family; verify fallback rendering on other systems.':null);
auditRule('typography','font-face-load-error','A declared font face failed to load','warning','observed','@document',(el,c)=>{let failed=0,count=0;for(const face of document.fonts||[]){if(count++>=1000){c.limit('Font status scan stopped at 1000 declared faces.');break}if(face.status==='error')failed++}return failed?failed+' declared font face(s) have status:error.':null});
typographyRule('break-all-prose','Latin prose breaks inside every word',(el,c,text,s)=>typographyProse(text)&&/[A-Za-z]{12}/.test(text)&&s.wordBreak==='break-all'?'Long Latin prose uses word-break:break-all; review readability.':null);
typographyRule('thin-small-text','Small text uses an extra-light weight',(el,c,text,s)=>typographyPixels(s.fontSize)<16&&typographyPixels(s.fontWeight)>0&&typographyPixels(s.fontWeight)<=200?'font-weight='+s.fontWeight+'; font-size='+s.fontSize+'; inspect glyph legibility.':null);
typographyRule('heavy-text-stroke','Text stroke may obscure letter interiors',(el,c,text,s)=>typographyPixels(s.webkitTextStrokeWidth)>typographyPixels(s.fontSize)*.12?'text-stroke-width='+s.webkitTextStrokeWidth+'; font-size='+s.fontSize+'.':null);
typographyRule('long-unbreakable-token','Long token has no emergency wrapping',(el,c,text,s)=>/\S{60}/.test(text)&&!['anywhere','break-word'].includes(s.overflowWrap)&&!['break-all','break-word'].includes(s.wordBreak)&&!['pre','pre-wrap'].includes(s.whiteSpace)?'A token of at least 60 characters has no emergency wrap setting.':null);
typographyRule('prose-selection-disabled','Prose cannot be selected normally',(el,c,text,s)=>typographyProse(text)&&s.userSelect==='none'?'A passage of at least 120 characters uses user-select:none; review copying and assistive workflows.':null);
typographyRule('text-indent-outside-box','Text indentation moves content beyond its box',(el,c,text,s)=>Math.abs(typographyPixels(s.textIndent))>Math.max(el.clientWidth,300)?'text-indent='+s.textIndent+' exceeds the text box width; inspect where the first line paints.':null);
typographyRule('bidi-control-characters','Text contains explicit bidi controls',(el,c,text)=>/[\u202a-\u202e\u2066-\u2069]/.test(text)?'Text contains explicit directional controls; verify intended reading and display order.':null);
typographyRule('invisible-characters-only','Text node contains only invisible formatting characters',(el,c,text)=>/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/.test(text)?'Nonempty text consists only of whitespace and invisible formatting characters.':null);
typographyRule('inline-link-cue-missing','Inline link has no visible typographic cue',(el,c,text,s)=>{if(!el.matches('a[href]')||!el.parentElement||!['p','li','blockquote'].includes(el.parentElement.localName))return null;const p=c.style(el.parentElement);return s.textDecorationLine==='none'&&s.color===p.color&&s.fontWeight===p.fontWeight?'Inline link has the same color and weight as surrounding prose and no text decoration.':null});
typographyRule('outside-list-marker-clipped','Outside list marker may be clipped',(el,c,text,s)=>{if(el.localName!=='li'||s.listStylePosition!=='outside'||s.listStyleType==='none'||!el.parentElement)return null;const p=c.style(el.parentElement);return ['hidden','clip'].includes(p.overflowX)&&typographyPixels(p.paddingInlineStart)<typographyPixels(s.fontSize)?'Outside list marker has less than 1em of start padding inside a clipping list container.':null});
typographyRule('replacement-character-text','Text contains Unicode replacement characters',(el,c,text)=>text.includes('\ufffd')?'Text includes U+FFFD; verify decoding and source content.':null);
typographyRule('raw-template-expression','Rendered prose contains an unresolved template pattern',(el,c,text)=>!el.closest('pre,code,kbd,samp')&&(/\{\{[^{}\n]{1,100}\}\}/.test(text)||/\$\{[^{}\n]{1,100}\}/.test(text))?'Rendered prose includes a template-expression pattern; verify interpolation.':null);
typographyRule('mojibake-text-pattern','Text resembles repeated UTF-8 decoding artifacts',(el,c,text)=>((text.match(/(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2\u20ac)/g)||[]).length>=2)?'Text contains repeated common UTF-8-as-Latin-1 artifacts; verify source encoding.':null);
`;
}
