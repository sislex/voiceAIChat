/** User-edit preparation is fixture-only: auditing itself never changes a control. */
export interface FormAuditFixture {
  rule: string
  broken: string
  fixed: string
  edit?: { broken: FormFixtureEdit; fixed: FormFixtureEdit }
}
export interface FormFixtureEdit { selector: string; text: string; after?: string }
const page = (body: string) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Form diagnostic fixture</title></head><body>'+body+'</body></html>'
const pair = (rule: string, broken: string, fixed: string): FormAuditFixture => ({ rule, broken: page(broken), fixed: page(fixed) })
const edited = (rule: string, body: string, broken: FormFixtureEdit, fixed: FormFixtureEdit): FormAuditFixture => ({ ...pair(rule, body, body), edit: { broken, fixed } })
export const formsAuditFixtures: FormAuditFixture[] = [
  pair('validity-value-missing','<input required>','<input required value="ready">'),
  pair('validity-type-mismatch','<input type="email" value="invalid">','<input type="email" value="a@example.test">'),
  pair('validity-pattern-mismatch','<input pattern="[0-9]{3}" value="abc">','<input pattern="[0-9]{3}" value="123">'),
  edited('validity-too-long','<input id="target">',{selector:'#target',text:'abcdef',after:'document.querySelector("#target").maxLength=2'},{selector:'#target',text:'abcdef',after:'document.querySelector("#target").maxLength=10'}),
  edited('validity-too-short','<input id="target" minlength="5">',{selector:'#target',text:'ab'},{selector:'#target',text:'abcdef'}),
  pair('validity-range-underflow','<input type="number" min="10" value="2">','<input type="number" min="10" value="12">'),
  pair('validity-range-overflow','<input type="number" max="10" value="12">','<input type="number" max="10" value="2">'),
  pair('validity-step-mismatch','<input type="number" min="0" step="2" value="3">','<input type="number" min="0" step="2" value="4">'),
  edited('validity-bad-input','<input id="target" type="number">',{selector:'#target',text:'e'},{selector:'#target',text:'42'}),
  pair('validity-custom-error','<input id="target"><script>document.querySelector("#target").setCustomValidity("Fixture error")</script>','<input id="target">'),
  pair('invalid-control-not-visible','<input required style="display:none">','<input required>'),
  pair('native-invalid-without-aria','<input required>','<input required aria-invalid="true">'),
  pair('aria-invalid-without-native','<input value="ready" aria-invalid="true">','<input value="ready" aria-invalid="false">'),
  pair('pattern-syntax-invalid','<input pattern="[">','<input pattern="[0-9]+">'),
  pair('required-type-ignored','<input type="range" required>','<input type="number" required>'),
  pair('pattern-type-ignored','<input type="number" pattern="[0-9]+">','<input pattern="[0-9]+">'),
  pair('minlength-type-ignored','<input type="number" minlength="2">','<input minlength="2">'),
  pair('maxlength-type-ignored','<input type="number" maxlength="2">','<input maxlength="2">'),
  pair('multiple-type-ignored','<input multiple>','<input type="email" multiple>'),
  pair('accept-type-ignored','<input type="email" accept="image/*">','<input type="file" accept="image/*">'),
  pair('length-constraints-reversed','<input minlength="10" maxlength="2">','<input minlength="2" maxlength="10">'),
  pair('range-constraints-reversed','<input type="number" min="10" max="2">','<input type="number" min="2" max="10">'),
  pair('min-syntax-invalid','<input type="number" min=" 2">','<input type="number" min="2">'),
  pair('max-syntax-invalid','<input type="date" max="2026-99-99">','<input type="date" max="2026-12-31">'),
  pair('step-syntax-invalid','<input type="number" step="0">','<input type="number" step="any">'),
  pair('input-type-unknown','<input type="emali">','<input type="email">'),
  pair('method-keyword-invalid','<form method="put"><button>Send</button></form>','<form method="post"><button>Send</button></form>'),
  pair('dialog-method-outside-dialog','<form method="dialog"><button>Close</button></form>','<dialog open><form method="dialog"><button>Close</button></form></dialog>'),
  pair('form-owner-missing','<input form="missing">','<form id="owner"></form><input form="owner">'),
  pair('submit-method-shadowed','<form><input name="submit"></form>','<form><input name="query"></form>')
]

/** Edge cases protect browser semantics that cannot be inferred from one happy path. */
export const formConstraintExamples: Array<{ name: string; html: string; rule: string; total: number }> = [
  { name: 'overnight time range', html: '<input type="time" min="22:00" max="02:00">', rule: 'range-constraints-reversed', total: 0 },
  { name: 'range metadata is not clamped to 0..100', html: '<input type="range" min="300" max="200">', rule: 'range-constraints-reversed', total: 1 },
  { name: 'valid week', html: '<input type="week" min="2026-W12">', rule: 'min-syntax-invalid', total: 0 },
  { name: 'invalid week', html: '<input type="week" min="2026-W99">', rule: 'min-syntax-invalid', total: 1 },
  { name: 'valid local date and time', html: '<input type="datetime-local" min="2026-09-11T01:00">', rule: 'min-syntax-invalid', total: 0 },
  { name: 'case-insensitive any step', html: '<input type="number" step="ANY">', rule: 'step-syntax-invalid', total: 0 },
  { name: 'whitespace in step', html: '<input type="number" step=" 2">', rule: 'step-syntax-invalid', total: 1 },
  { name: 'disabled validity exclusion', html: '<input required disabled>', rule: 'validity-value-missing', total: 0 },
  { name: 'readonly validity exclusion', html: '<textarea required readonly></textarea>', rule: 'validity-value-missing', total: 0 },
  { name: 'programmatic length differs from user editing', html: '<input minlength="10" value="ab">', rule: 'validity-too-short', total: 0 },
  { name: 'invalid content in closed details', html: '<details><summary>More</summary><input required></details>', rule: 'invalid-control-not-visible', total: 1 },
  { name: 'CSS-visible hidden attribute', html: '<input required hidden style="display:block">', rule: 'invalid-control-not-visible', total: 0 },
  { name: 'Unicode-sets pattern', html: '<input pattern="[\\p{ASCII}&&\\p{Letter}]+">', rule: 'pattern-syntax-invalid', total: 0 },
  { name: 'external submit shadowing', html: '<form id="owner"></form><input form="owner" name="submit">', rule: 'submit-method-shadowed', total: 1 }
]

export const formReadOnlyScene = page('<style>body{height:1600px}</style><input id="target" type="password" required value="PRIVATE_FORM_VALUE"><script>document.querySelector("#target").setCustomValidity("PRIVATE_CUSTOM_ERROR")</script>')
export const formReadOnlySetup = String.raw`(()=>{
  const target=document.querySelector('#target');target.focus();target.setSelectionRange(1,3);scrollTo(0,200);
  Object.defineProperty(target,'value',{get(){throw new Error('Live value getter must not be used by an audit')}});
  Object.defineProperty(target,'validationMessage',{get(){throw new Error('Validation message getter must not be used by an audit')}});
  window.formInvalidEvents=0;window.formMutations=0;
  document.addEventListener('invalid',()=>window.formInvalidEvents++,true);
  new MutationObserver(records=>window.formMutations+=records.length).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
})()`
export const formReadOnlyState = `({dom:document.documentElement.outerHTML,active:document.activeElement.id,start:document.querySelector('#target').selectionStart,end:document.querySelector('#target').selectionEnd,scrollY,invalid:window.formInvalidEvents,mutations:window.formMutations})`
