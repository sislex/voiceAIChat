/** dispatchEvent клавиатуры не выполняет браузерное действие по умолчанию: его воспроизводим явно. */
export function previewKeyboardHelpers(): string {
 return String.raw`const keyChord=value=>{
  const aliases={Ctrl:'Control',Cmd:'Meta',Command:'Meta',Esc:'Escape',Space:' ',Spacebar:' '};
  let parts=String(value).split('+');if(parts.length>1&&parts.at(-1)===''){parts.pop();parts[parts.length-1]='+'}
  let key=parts.pop();key=aliases[key]||key;const modifiers=new Set(parts.map(part=>aliases[part]||part));
  if(modifiers.has('ControlOrMeta')){modifiers.delete('ControlOrMeta');modifiers.add(/Mac|iPhone|iPad/.test(navigator.platform)?'Meta':'Control')}
  if(!key||[...modifiers].some(part=>!['Shift','Control','Alt','Meta'].includes(part)))throw new Error('Неизвестное сочетание клавиш: '+value);
  const codes={Enter:13,Escape:27,Tab:9,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,' ':32};
  const code=/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():/^\d$/.test(key)?'Digit'+key:key===' '?'Space':key;
  return {key,code,bubbles:true,cancelable:true,composed:true,shiftKey:modifiers.has('Shift'),ctrlKey:modifiers.has('Control'),altKey:modifiers.has('Alt'),metaKey:modifiers.has('Meta'),keyCode:codes[key]||(/^[a-z\d]$/i.test(key)?key.toUpperCase().charCodeAt(0):0)}
};
const keyboardEditable=el=>el.localName==='textarea'||el.localName==='input'&&['text','search','url','tel','email','password'].includes(el.type)||el.isContentEditable;
const keyboardWrite=(el,text,inputType)=>{
  actionable(el,true);const editable=el.isContentEditable;
  if(!editable&&!keyboardEditable(el))throw new Error('Этот тип поля изменяется через type или set');
  let start=editable?0:el.selectionStart,end=editable?0:el.selectionEnd;
  if(!editable&&(start===null||end===null)){start=el.value.length;end=start}
  let before=editable?el.textContent:el.value;
  if(!editable&&inputType==='deleteContentBackward'&&start===end&&start>0)start-=Array.from(before.slice(0,start)).at(-1).length;
  if(!editable&&inputType==='deleteContentForward'&&start===end&&end<before.length)end+=Array.from(before.slice(end))[0].length;
  const next=editable?null:before.slice(0,start)+text+before.slice(end);if(!editable)validateInput(el,next);
  if(!el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true,inputType,data:inputType.startsWith('delete')?null:text})))return false;
  if(editable){
    const selection=getSelection();let range=selection&&selection.rangeCount?selection.getRangeAt(0):null;
    if(!range||!el.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(el);range.collapse(false)}
    if(inputType.startsWith('delete')&&range.collapsed){if(selection&&selection.modify){selection.removeAllRanges();selection.addRange(range);const original=range.cloneRange();selection.modify('extend',inputType==='deleteContentBackward'?'backward':'forward','character');const extended=selection.getRangeAt(0);range=el.contains(extended.commonAncestorContainer)?extended:original}}
    range.deleteContents();if(text){const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true)}if(selection){selection.removeAllRanges();selection.addRange(range)}
  }else{setNativeValue(el,next);try{el.setSelectionRange(start+text.length,start+text.length)}catch{}}
  el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType,data:inputType.startsWith('delete')?null:text}));return true
};
const keyboardTabs=()=>{
  const all=[...document.querySelectorAll('a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=true]')].filter(el=>readingVisible(el)&&el.tabIndex>=0&&!el.matches(':disabled')&&!el.closest('[inert],[aria-disabled="true"]'));
  return all.filter(el=>{if(el.localName!=='input'||el.type!=='radio'||!el.name)return true;const group=all.filter(other=>other.localName==='input'&&other.type==='radio'&&other.name===el.name&&other.form===el.form);return el===(group.find(radio=>radio.checked)||group[0])}).map((el,index)=>({el,index})).sort((a,b)=>{const ap=a.el.tabIndex>0?a.el.tabIndex:Infinity,bp=b.el.tabIndex>0?b.el.tabIndex:Infinity;return ap-bp||a.index-b.index}).map(item=>item.el)
};
const keyboardDefault=(el,opts)=>{
  const key=opts.key,modified=opts.ctrlKey||opts.metaKey||opts.altKey;
  if(key==='Tab'&&!modified){const items=keyboardTabs();if(items.length){const current=items.indexOf(el),index=current<0?(opts.shiftKey?items.length-1:0):(current+(opts.shiftKey?-1:1)+items.length)%items.length;items[index].focus()}return}
  if((opts.ctrlKey||opts.metaKey)&&!opts.altKey&&key.toLowerCase()==='a'&&keyboardEditable(el)){if(el.isContentEditable){const selection=getSelection(),range=document.createRange();range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range)}else el.select();return}
  if(modified)return;
  if(el.localName==='select'&&['ArrowDown','ArrowUp','Home','End'].includes(key)){
    actionable(el,true);const options=[...el.options].filter(option=>!option.disabled&&!(option.parentElement.localName==='optgroup'&&option.parentElement.disabled));if(!options.length)return;const index=options.findIndex(option=>option.selected),next=key==='Home'?0:key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(key==='ArrowUp'?-1:1)));if(el.value!==options[next].value){el.value=options[next].value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}return
  }
  if(key==='Enter'){
    if(el.localName==='textarea'||el.isContentEditable){keyboardWrite(el,'\n','insertLineBreak');return}
    if(el.matches('button,a[href],summary,input[type=submit],input[type=button],input[type=reset]')){el.click();return}
    if(el.form){const submitter=[...el.form.elements].find(control=>!control.matches(':disabled')&&(control.localName==='button'&&control.type==='submit'||control.localName==='input'&&['submit','image'].includes(control.type)));el.form.requestSubmit?el.form.requestSubmit(submitter):el.form.submit();return}
  }
  if(key===' '&&el.matches('button,summary,input[type=checkbox],input[type=radio],input[type=button],input[type=submit],input[type=reset]'))return ()=>el.click();
  if(keyboardEditable(el)){
    if(['Backspace','Delete'].includes(key)){keyboardWrite(el,'',key==='Backspace'?'deleteContentBackward':'deleteContentForward');return}
    if(['ArrowLeft','ArrowRight','Home','End'].includes(key)&&!el.isContentEditable&&el.selectionStart!==null){
      const start=el.selectionStart,end=el.selectionEnd,backward=el.selectionDirection==='backward';let focus=backward?start:end,anchor=backward?end:start;
      if(!opts.shiftKey&&start!==end&&['ArrowLeft','ArrowRight'].includes(key))focus=key==='ArrowLeft'?start:end;
      else if(key==='Home')focus=el.localName==='textarea'?el.value.lastIndexOf('\n',Math.max(0,focus-1))+1:0;
      else if(key==='End'){const newline=el.value.indexOf('\n',focus);focus=el.localName==='textarea'&&newline>=0?newline:el.value.length}
      else if(key==='ArrowLeft')focus-=focus>0?Array.from(el.value.slice(0,focus)).at(-1).length:0;
      else focus+=focus<el.value.length?Array.from(el.value.slice(focus))[0].length:0;
      if(!opts.shiftKey)anchor=focus;el.setSelectionRange(Math.min(anchor,focus),Math.max(anchor,focus),focus<anchor?'backward':'forward');return
    }
    if(Array.from(key).length===1)keyboardWrite(el,key,'insertText');return
  }
};
const performKey=(el,value)=>{
  actionable(el);const opts=keyChord(value);let after;
  const allowed=el.dispatchEvent(new KeyboardEvent('keydown',opts));
  try{if(allowed){const printable=Array.from(opts.key).length===1||opts.key==='Enter';if(!printable||el.dispatchEvent(new KeyboardEvent('keypress',opts)))after=keyboardDefault(el,opts)}}
  finally{el.dispatchEvent(new KeyboardEvent('keyup',opts))}
  if(typeof after==='function')after();return {key:value,selector:el===document.body?'body':uniqueSelector(el)}
};
`;
}
