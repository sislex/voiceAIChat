export interface FocusAuditFixture { rule: string; name?: string; broken: string; fixed: string; ready?: string }
const page=(body:string)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Focus diagnostic fixture</title></head><body>'+body+'</body></html>'
const pair=(rule:string,broken:string,fixed:string,name?:string):FocusAuditFixture=>({rule,broken:page(broken),fixed:page(fixed),...(name?{name}:{})})
const focused=(rule:string,broken:string,fixed:string,name?:string):FocusAuditFixture=>({...pair(rule,broken+'<script>document.querySelector("#target").focus({preventScroll:true})</script>',fixed+'<script>document.querySelector("#target").focus({preventScroll:true})</script>',name),ready:'document.activeElement?.id === "target"'})
export const focusAuditFixtures:FocusAuditFixture[]=[
  pair('tabindex-syntax-invalid','<button tabindex="0junk">Save</button>','<button tabindex="0">Save</button>'),
  pair('dialog-tabindex-declared','<dialog open tabindex="0">Panel</dialog>','<dialog open>Panel</dialog>'),
  pair('autofocus-conflict','<input autofocus><input autofocus>','<input autofocus><input>','document autofocus conflict'),
  pair('autofocus-conflict','<dialog><input autofocus><input autofocus></dialog>','<dialog><input autofocus><input></dialog>','dialog autofocus conflict'),
  pair('autofocus-conflict','<div popover><input autofocus><input autofocus></div>','<div popover><input autofocus><input></div>','popover autofocus conflict'),
  pair('autofocus-disabled','<input autofocus disabled>','<input autofocus>'),
  pair('autofocus-not-visible','<input autofocus style="display:none">','<input autofocus>'),
  pair('autofocus-no-focus-target','<div autofocus>Target</div>','<div autofocus tabindex="-1">Target</div>'),
  pair('custom-widget-no-tab-entry','<div role="button">Save</div>','<div role="button" tabindex="0">Save</div>'),
  pair('native-control-negative-tabindex','<button tabindex="-1">Save</button>','<button>Save</button>'),
  pair('inline-click-no-tab-entry','<div onclick="window.clicked=true">Save</div>','<button onclick="window.clicked=true">Save</button>'),
  pair('scroll-region-negative-tabindex','<div tabindex="-1" style="overflow:auto;height:40px"><p style="height:120px">Long content</p></div>','<div tabindex="0" style="overflow:auto;height:40px"><p style="height:120px">Long content</p></div>'),
  pair('inputmode-keyword-invalid','<input inputmode="numbers">','<input inputmode="numeric">'),
  pair('enterkeyhint-keyword-invalid','<input enterkeyhint="submit">','<input enterkeyhint="send">'),
  pair('accesskey-token-invalid','<button accesskey="save">Save</button>','<button accesskey="s 1">Save</button>'),
  pair('accesskey-candidate-conflict','<button accesskey="s">Save</button><button accesskey="s">Search</button>','<button accesskey="s">Save</button><button accesskey="f">Search</button>'),
  focused('focus-paint-needs-review','<input id="target" style="outline:none;box-shadow:none">','<input id="target" style="outline:2px solid blue">'),
  focused('focus-outline-transparent','<input id="target" style="outline:2px solid transparent">','<input id="target" style="outline:2px solid blue">'),
  focused('focused-caret-transparent','<input id="target" style="caret-color:transparent">','<input id="target" style="caret-color:black">','transparent input caret'),
  focused('focused-caret-transparent','<div id="target" contenteditable style="caret-color:transparent">Edit</div>','<div id="target" contenteditable style="caret-color:black">Edit</div>','transparent editable-host caret'),
  focused('focused-opacity-zero','<div style="opacity:0"><input id="target"></div>','<div><input id="target"></div>'),
  focused('focused-outside-viewport','<input id="target" style="position:fixed;left:-1000px">','<input id="target">'),
  focused('focused-zero-size','<input id="target" style="width:0;padding:0;border:0">','<input id="target" style="width:100px">','zero-width focus target'),
  focused('focused-zero-size','<input id="target" style="height:0;padding:0;border:0">','<input id="target" style="height:30px">','zero-height focus target'),
  pair('focus-flex-order-reversed','<div style="display:flex;flex-direction:row-reverse"><button>One</button><button>Two</button></div>','<div style="display:flex"><button>One</button><button>Two</button></div>'),
  pair('focus-grid-order-reversed','<div style="display:grid;grid-template-columns:100px 100px"><button style="grid-column:2;grid-row:1">One</button><button style="grid-column:1;grid-row:1">Two</button></div>','<div style="display:grid;grid-template-columns:100px 100px"><button>One</button><button>Two</button></div>'),
  focused('focused-aria-hidden','<div aria-hidden="true"><input id="target"></div>','<div><input id="target"></div>'),
  focused('active-descendant-missing','<input id="target" aria-activedescendant="missing">','<input id="target" aria-activedescendant="option"><div id="option">Choice</div>'),
  focused('active-descendant-hidden','<input id="target" aria-activedescendant="option"><div id="option" hidden>Choice</div>','<input id="target" aria-activedescendant="option"><div id="option">Choice</div>'),
  focused('active-descendant-unrelated','<input id="target" aria-activedescendant="option"><div id="options"><div id="option">Choice</div></div>','<input id="target" aria-activedescendant="option" aria-controls="options"><div id="options"><div id="option">Choice</div></div>')
]

/** Comparisons preserve valid browser behavior around the diagnostic candidates. */
export const focusComparisonExamples: Array<[string, string, string, number]> = [
 ['native modal background is inactive','<div role="button">Background</div><dialog id="modal"><button>Close</button></dialog><script>document.querySelector("#modal").showModal()</script>','custom-widget-no-tab-entry',0],
 ['native modal escapes ancestor inert','<div inert><dialog id="modal"><div role="button">Action</div></dialog></div><script>document.querySelector("#modal").showModal()</script>','custom-widget-no-tab-entry',1],
 ['explicit inert inside a modal stays inactive','<dialog id="modal"><button>Close</button><div inert><div role="button">Action</div></div></dialog><script>document.querySelector("#modal").showModal()</script>','custom-widget-no-tab-entry',0],
 ['active modal differs from DOM-last modal','<dialog id="first"><button>Close</button></dialog><dialog id="second"><div role="button">Background action</div></dialog><script>document.querySelector("#second").showModal();document.querySelector("#first").showModal()</script>','custom-widget-no-tab-entry',0],
 ['independent autofocus scopes','<input autofocus><dialog><input autofocus></dialog><div popover><input autofocus></div>','autofocus-conflict',0],
 ['pending closed dialog','<dialog><input autofocus></dialog>','autofocus-not-visible',0],
 ['pending closed popover','<div popover><input autofocus></div>','autofocus-not-visible',0],
 ['native disabled fieldset','<fieldset disabled><input autofocus></fieldset>','autofocus-disabled',1],
 ['first legend exemption','<fieldset disabled><legend><input autofocus></legend></fieldset>','autofocus-disabled',0],
 ['editing host native focus','<div contenteditable autofocus>Edit</div>','autofocus-no-focus-target',0],
 ['dialog native focus','<dialog open autofocus>Panel</dialog>','autofocus-no-focus-target',0],
 ['first summary native focus','<details open><p>Lead</p><summary autofocus>More</summary></details>','autofocus-no-focus-target',0],
 ['roving composite','<div role=toolbar><button tabindex=-1>Action</button></div>','native-control-negative-tabindex',0],
 ['child keyboard entry scrolls','<div tabindex=-1 style="height:40px;overflow:auto"><button>Action</button><p style=height:120px>Content</p></div>','scroll-region-negative-tabindex',0],
 ['unicode accesskey','<button accesskey="😀 s">Action</button>','accesskey-token-invalid',0],
 ['duplicate accesskey tokens','<button accesskey="s s">Action</button>','accesskey-token-invalid',1],
 ['hidden shortcut is not active','<button accesskey=s hidden>Hidden</button><button accesskey=s>Save</button>','accesskey-candidate-conflict',0],
 ['CSS reading flow owns order','<div style="display:flex;flex-direction:row-reverse;reading-flow:flex-visual"><button>One</button><button>Two</button></div>','focus-flex-order-reversed',0],
 ['explicit positive tab order matches geometry','<div style="display:flex;flex-direction:row-reverse"><button tabindex=2>One</button><button tabindex=1>Two</button></div>','focus-flex-order-reversed',0],
 ['right-to-left native order','<div style="display:flex;direction:rtl"><button>One</button><button>Two</button></div>','focus-flex-order-reversed',0],
 ['focus shadow is an alternative','<input id=target style="outline:none;box-shadow:0 0 0 2px blue"><script>document.querySelector("#target").focus()</script>','focus-paint-needs-review',0],
 ['readonly has no editable caret','<input id=target readonly style=caret-color:transparent><script>document.querySelector("#target").focus()</script>','focused-caret-transparent',0],
 ['open shadow active focus is not host paint','<div id=target></div><script>const shadow=document.querySelector("#target").attachShadow({mode:"open"});shadow.innerHTML="<input>";shadow.querySelector("input").focus()</script>','focus-paint-needs-review',0],
 ['owned active descendant','<input id=target aria-activedescendant=option aria-owns=options><div id=options><span id=option>Choice</span></div><script>document.querySelector("#target").focus()</script>','active-descendant-unrelated',0]
]

export const focusReadOnlyScene = page('<style>body{height:1600px}</style><input id="target" type="password" value="PRIVATE_FOCUS_VALUE" style="outline:none;caret-color:transparent">')
export const focusReadOnlySetup = String.raw`(()=>{
  const target=document.querySelector('#target');target.focus();target.setSelectionRange(1,3);scrollTo(0,200);
  Object.defineProperty(target,'value',{get(){throw new Error('Live value getter must not be used by a focus audit')}});
  window.focusAuditEvents=0;window.focusAuditMutations=0;
  document.addEventListener('focusin',()=>window.focusAuditEvents++,true);
  new MutationObserver(records=>window.focusAuditMutations+=records.length).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
})()`
export const focusReadOnlyState = `({dom:document.documentElement.outerHTML,active:document.activeElement.id,start:document.querySelector('#target').selectionStart,end:document.querySelector('#target').selectionEnd,scrollY,events:window.focusAuditEvents,mutations:window.focusAuditMutations})`
export const focusOrderScene = page('<div id="row" style="display:flex;flex-direction:row-reverse"><button id="first">First in DOM</button><button id="second">Second in DOM</button></div>')
