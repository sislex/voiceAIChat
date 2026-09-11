/** Read browser validity without triggering invalid events or copying entered values. */
export function formsAuditRules(): string {
  return String.raw`
const formControls='input,textarea,select,button';
const formTextTypes=new Set(['text','search','url','tel','email','password']);
const formRangeTypes=new Set(['number','range','date','datetime-local','month','time','week']);
const formRequiredTypes=new Set(['text','search','url','tel','email','password','number','date','datetime-local','month','time','week','checkbox','radio','file']);
const formKnownTypes=new Set([...formRequiredTypes,'hidden','range','color','submit','image','reset','button']);
const formRule=(id,title,selector,check,severity='warning',confidence='heuristic')=>auditRule('forms',id,title,severity,confidence,selector,check);
const formNative=(el,c)=>{
  const cache=c.formNativeCache||(c.formNativeCache=new WeakMap());if(cache.has(el))return cache.get(el);
  const state=el.willValidate&&el.validity?{valid:el.validity.valid,...Object.fromEntries(['valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'].map(key=>[key,el.validity[key]]))}:null;
  cache.set(el,state);return state;
};
for(const [id,key,title] of [
  ['value-missing','valueMissing','A required control has no accepted value'],
  ['type-mismatch','typeMismatch','Input does not match its native type'],
  ['pattern-mismatch','patternMismatch','Input does not match its declared pattern'],
  ['too-long','tooLong','User input exceeds the native maximum length'],
  ['too-short','tooShort','User input is shorter than the native minimum length'],
  ['range-underflow','rangeUnderflow','Input is below the native minimum'],
  ['range-overflow','rangeOverflow','Input is above the native maximum'],
  ['step-mismatch','stepMismatch','Input is off the native step interval'],
  ['bad-input','badInput','Browser cannot convert the current input'],
  ['custom-error','customError','Application has set a custom validity error']
])formRule('validity-'+id,title,formControls,(el,c)=>formNative(el,c)?.[key]?'Browser ValidityState.'+key+' is true; this is current form state, not proof of a bug.':null,'info','observed');
formRule('invalid-control-not-visible','Invalid control is not visibly rendered',formControls,(el,c)=>formNative(el,c)?.valid===false&&!(typeof el.checkVisibility==='function'?el.checkVisibility({opacityProperty:true,visibilityProperty:true,contentVisibilityAuto:true}):c.visible(el))?'Native invalid state belongs to a control that is not visibly rendered; inspect how the user can correct it.':null);
const formAriaInvalid=el=>{const value=el.getAttribute('aria-invalid');return value!==null&&value!==''&&value.toLowerCase()!=='false'};
formRule('native-invalid-without-aria','Native invalid state has no declared ARIA error',formControls,(el,c)=>formNative(el,c)?.valid===false&&!formAriaInvalid(el)?'Native validity is false while aria-invalid does not declare an error; review the intended validation timing and error announcement.':null);
formRule('aria-invalid-without-native','Declared ARIA error differs from native validity',formControls,(el,c)=>formNative(el,c)?.valid===true&&formAriaInvalid(el)?'aria-invalid declares an error while native validity is true; custom or server validation may explain this state.':null);
const formAttribute=(el,name,c)=>{const value=el.getAttribute(name);if(value!==null&&value.length>4096){c.limit('Form constraint inspection stopped at 4096 attribute characters.');return undefined}return value};
formRule('pattern-syntax-invalid','Pattern constraint has invalid expression syntax','input[pattern]',(el,c)=>{
  if(!formTextTypes.has(el.type))return null;const pattern=formAttribute(el,'pattern',c);if(pattern===undefined)return null;
  try{new RegExp('','v')}catch{c.limit('This browser cannot inspect pattern constraints with Unicode-sets semantics.');return null}
  try{new RegExp(pattern,'v');return null}catch{return 'The pattern attribute cannot compile using HTML Unicode-sets semantics; native pattern validation ignores it.'}
});
formRule('required-type-ignored','Input type ignores required','input[required]',el=>!formRequiredTypes.has(el.type)?'The required attribute does not apply to this native input type.':null);
formRule('pattern-type-ignored','Input type ignores pattern','input[pattern]',el=>!formTextTypes.has(el.type)?'The pattern attribute does not apply to this native input type.':null);
for(const attribute of ['minlength','maxlength'])formRule(attribute+'-type-ignored','Control type ignores '+attribute,'input['+attribute+'],textarea['+attribute+']',el=>el.localName==='input'&&!formTextTypes.has(el.type)?'The '+attribute+' attribute does not apply to this native input type.':null);
formRule('multiple-type-ignored','Input type ignores multiple','input[multiple]',el=>!['email','file'].includes(el.type)?'The multiple attribute applies only to email and file inputs.':null);
formRule('accept-type-ignored','Input type ignores file acceptance metadata','input[accept]',el=>el.type!=='file'?'The accept attribute does not constrain a non-file input.':null);
formRule('length-constraints-reversed','Minimum length exceeds maximum length','input[minlength][maxlength],textarea[minlength][maxlength]',el=>(el.localName==='textarea'||formTextTypes.has(el.type))&&el.minLength>=0&&el.maxLength>=0&&el.minLength>el.maxLength?'Native minLength exceeds maxLength; no nonempty user input can satisfy both length constraints.':null);
const formConstraint=(el,name,c)=>{
  const cache=c.formConstraintCache||(c.formConstraintCache=new WeakMap());let entry=cache.get(el);if(!entry){entry={};cache.set(el,entry)}if(name in entry)return entry[name];
  const raw=formAttribute(el,name,c);if(raw===undefined||raw===null||raw==='')return entry[name]={known:raw!==undefined,empty:true};
  const parser=document.createElement('input'),type=el.type==='range'?'number':el.type;parser.type=type;
  if(parser.type!==type){c.limit('This browser does not support a declared form constraint parser.');return entry[name]={known:false}}
  parser.value=raw;
  if(parser.value==='')return entry[name]={known:true,valid:false};
  const number=parser.valueAsNumber;if(!Number.isFinite(number)){c.limit('A form constraint is outside the numeric range supported by the browser parser.');return entry[name]={known:false}}
  return entry[name]={known:true,valid:true,number};
};
formRule('range-constraints-reversed','Minimum constraint exceeds maximum','input[min][max]',(el,c)=>{
  if(!formRangeTypes.has(el.type)||el.type==='time')return null;
  const min=formConstraint(el,'min',c),max=formConstraint(el,'max',c);return min.valid&&max.valid&&min.number>max.number?'Parsed minimum exceeds maximum; periodic time inputs are excluded because overnight ranges are valid.':null;
});
for(const name of ['min','max'])formRule(name+'-syntax-invalid','Native '+name+' constraint has invalid syntax','input['+name+']',(el,c)=>formRangeTypes.has(el.type)&&formConstraint(el,name,c).valid===false?'The '+name+' attribute cannot be parsed for this native input type and is ignored.':null);
formRule('step-syntax-invalid','Native step constraint has invalid syntax','input[step]',(el,c)=>{
  if(!formRangeTypes.has(el.type))return null;const raw=formAttribute(el,'step',c);if(raw===undefined||raw===null||raw===''||raw.toLowerCase()==='any')return null;
  const parser=document.createElement('input');parser.type='number';parser.value=raw;
  return parser.value===''||!Number.isFinite(parser.valueAsNumber)||parser.valueAsNumber<=0?'Step is not a positive floating-point number or the any keyword; the browser uses its default step.':null;
});
formRule('input-type-unknown','Unknown input type falls back to text','input[type]',el=>{const type=el.getAttribute('type');return type&&!formKnownTypes.has(type.toLowerCase())&&el.type==='text'?'Declared input type is unrecognized and the browser uses text semantics.':null});
const formSubmitter=el=>el.localName==='button'&&el.type==='submit'||el.localName==='input'&&['submit','image'].includes(el.type);
formRule('method-keyword-invalid','Form submission method keyword is invalid','form[method],button[formmethod],input[formmethod]',el=>{
  if(el.localName!=='form'&&!formSubmitter(el))return null;const value=el.getAttribute(el.localName==='form'?'method':'formmethod');
  return value&&!['get','post','dialog'].includes(value.toLowerCase())?'Submission method is not get, post or dialog; inspect the resulting native submission behavior.':null;
});
formRule('dialog-method-outside-dialog','Dialog submission has no containing dialog','form[method],button[formmethod],input[formmethod]',el=>{
  if(el.localName!=='form'&&!formSubmitter(el))return null;const form=el.localName==='form'?el:el.form,value=el.getAttribute(el.localName==='form'?'method':'formmethod');
  return value?.toLowerCase()==='dialog'&&form&&!form.closest('dialog')?'The dialog method has no ancestor dialog on its form and cannot close one.':null;
});
formRule('form-owner-missing','Explicit form owner cannot be resolved','input[form],button[form],select[form],textarea[form],fieldset[form],output[form],object[form]',el=>!el.form?'The explicit form attribute does not resolve to an owning form in this document.':null);
formRule('submit-method-shadowed','Named form content shadows the submit method','form',(el,c)=>typeof el.submit!=='function'&&c.all('[name="submit"],[id="submit"]').some(control=>control.form===el)?'A form-associated control named or identified as submit shadows form.submit; direct method calls may fail.':null);
`;
}
