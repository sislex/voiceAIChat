/** Follow computed visibility so CSS overrides and semantic containers remain readable. */
export function previewInteractionHelpers(): string {
  return `const actionVisible=(el)=>{
  if(!el.isConnected||['script','style','template','noscript'].includes(el.localName))return false;
  if(['hidden','collapse'].includes(getComputedStyle(el).visibility))return false;
  for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||Number.parseFloat(style.opacity)===0)return false}
  return true
};
const chooseTarget=(action,clickable=false)=>{
  let candidates=[...new Set(findTargets(action).map(el=>clickable?clickTarget(el):el))].filter(actionVisible);
  if(!candidates.length)throw new Error('Элемент не найден или скрыт: '+(action.selector||action.text));
  if(!action.selector){
    const controls=candidates.filter(el=>el.matches(CLICKABLE));if(controls.length)candidates=controls;
    const text=String(action.text||'').trim().toLowerCase();const exact=candidates.filter(el=>textOf(el).toLowerCase()===text);if(exact.length)candidates=exact
  }
  if(candidates.length!==1)throw new Error('Селектор неоднозначен ('+candidates.length+'): '+candidates.slice(0,5).map(uniqueSelector).join(', '));
  return candidates[0]
};
const actionable=(el,write=false)=>{
  if(!actionVisible(el))throw new Error('Элемент скрыт');
  if(el.matches(':disabled')||el.closest('[aria-disabled="true"],[inert]'))throw new Error('Элемент отключён — действие не выполнено');
  if(write&&(el.readOnly===true||el.closest('[aria-readonly="true"]')))throw new Error('Поле доступно только для чтения')
};
const selectOption=(el,value)=>{
  const wanted=String(value);const option=[...el.options].find(o=>o.value===wanted)||[...el.options].find(o=>textOf(o).toLowerCase()===wanted.toLowerCase());
  if(!option)throw new Error('Опция не найдена: '+wanted);
  if(option.disabled||option.parentElement&&option.parentElement.localName==='optgroup'&&option.parentElement.disabled)throw new Error('Опция отключена: '+wanted);
  return option
};
const validateInput=(el,text)=>{
  if(el.localName==='input'&&['checkbox','radio','file','button','submit','reset','image','hidden'].includes(el.type))throw new Error('Для этого поля используйте set, upload или click');
  if((el.localName==='input'||el.localName==='textarea')&&el.maxLength>=0&&text.length>el.maxLength)throw new Error('Текст превышает maxlength='+el.maxLength);
  if(el.localName==='input'&&text){const probe=el.cloneNode(false);probe.value=text;if(probe.value==='')throw new Error('Значение не подходит типу поля '+el.type)}
};
const inputEvent=(name,text,cancelable=false)=>new (window.InputEvent||Event)(name,{bubbles:true,composed:true,cancelable,data:text,inputType:'insertReplacementText'});
`;
}
