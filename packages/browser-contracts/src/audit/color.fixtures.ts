const document = (body: string, css = '', canvas = 'white') => `<!doctype html><html lang="en"><head><title>Color fixture</title><style>body{margin:8px;background:${canvas};font:16px Arial,sans-serif;color:black}main{position:relative;width:700px;max-width:100%}${css}</style></head><body><main>${body}</main></body></html>`
const text = (name: string, broken: string, fixed: string) => ({ name, rule: 'text-contrast-low', broken: document('<p style="'+broken+'">Contrast sample</p>'), fixed: document('<p style="'+fixed+'">Contrast sample</p>') })
const unknown = (name: string, broken: string, fixed: string) => ({ name, rule: 'color-inspection-incomplete', broken: document('<p style="'+broken+'">Paint sample</p>'), fixed: document('<p style="'+fixed+'">Paint sample</p>') })
const pair = (name: string, rule: string, broken: string, fixed: string) => ({ name, rule, broken: document(broken), fixed: document(fixed) })
export const colorAuditFixtures = [
  text('normal text contrast', 'color:#ccc', 'color:black'),
  text('alpha foreground', 'color:rgba(0,0,0,.3)', 'color:rgba(0,0,0,1)'),
  pair('nested translucent backgrounds','text-contrast-low','<section style="background:black"><div style="background:rgba(255,255,255,.5)"><p style="color:#999">Contrast sample</p></div></section>','<section style="background:black"><div style="background:rgba(255,255,255,.5)"><p style="color:black">Contrast sample</p></div></section>'),
  pair('ancestor opacity groups','text-contrast-low','<section style="opacity:.3"><p>Contrast sample</p></section>','<section style="opacity:1"><p>Contrast sample</p></section>'),
  text('large regular threshold', 'color:#888;font-size:20px', 'color:#888;font-size:24px'),
  text('large bold threshold', 'color:#888;font-size:13pt;font-weight:700', 'color:#888;font-size:14pt;font-weight:700'),
  { name: 'placeholder text', rule: 'placeholder-contrast-low', broken: document('<input placeholder="Search">','input::placeholder{color:#ccc;opacity:1}input{background:white}'), fixed: document('<input placeholder="Search">','input::placeholder{color:black;opacity:1}input{background:white}') },
  pair('inactive controls are excluded','text-contrast-low','<button style="color:#ccc;background:white">Action</button>','<button disabled style="color:#ccc;background:white">Action</button>'),
  unknown('gradient background is indeterminate', 'background:linear-gradient(white,black)', 'background:white'),
  unknown('image background is indeterminate', 'background-image:url(data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E)', 'background:white'),
  pair('occlusion is reported','color-inspection-incomplete','<div style="width:150px;height:30px">Covered</div><div style="position:absolute;inset:0;width:150px;height:30px;background:white"></div>','<div style="width:150px;height:30px">Visible</div>'),
  unknown('blend mode is indeterminate', 'mix-blend-mode:multiply', 'mix-blend-mode:normal'),
  unknown('filter is indeterminate', 'filter:blur(1px)', 'filter:none'),
  unknown('text shadow needs paint review', 'text-shadow:1px 1px 2px black', 'text-shadow:none'),
  { name: 'transparent canvas is not assumed white', rule: 'color-inspection-incomplete', broken: document('<p>Canvas sample</p>','','transparent'), fixed: document('<p>Canvas sample</p>') },
  text('legacy rgba parsing', 'color:rgba(200, 200, 200, 1)', 'color:rgba(0, 0, 0, 1)'),
  text('modern sRGB color parsing', 'color:color(srgb .8 .8 .8)', 'color:color(srgb 0 0 0)'),
  text('display-p3 approximation', 'color:color(display-p3 .8 .8 .8)', 'color:color(display-p3 0 0 0)'),
  text('Lab color parsing', 'color:lab(80% 0 0)', 'color:lab(0% 0 0)'),
  text('LCH color parsing', 'color:lch(80% 0 0)', 'color:lch(0% 0 0)'),
  text('OKLab color parsing', 'color:oklab(80% 0 0)', 'color:oklab(0% 0 0)'),
  text('OKLCH color parsing', 'color:oklch(80% 0 0)', 'color:oklch(0% 0 0)'),
  text('text fill overrides color', 'color:black;-webkit-text-fill-color:#ccc', 'color:black;-webkit-text-fill-color:black'),
  { name: 'before text', rule: 'before-contrast-low', broken: document('<div class="sample"></div>','.sample::before{content:"Before";color:#ccc}'), fixed: document('<div class="sample"></div>','.sample::before{content:"Before";color:black}') },
  { name: 'after text', rule: 'after-contrast-low', broken: document('<div class="sample"></div>','.sample::after{content:"After";color:#ccc}'), fixed: document('<div class="sample"></div>','.sample::after{content:"After";color:black}') },
  { name: 'selection colors', rule: 'selection-contrast-low', broken: document('<p>Selection sample</p>','::selection{background:white;color:#ccc}'), fixed: document('<p>Selection sample</p>','::selection{background:black;color:white}') },
  pair('current focus outline','focus-outline-contrast-low','<input id="focus" style="outline:3px solid #ccc"><script>document.querySelector("input").focus()</script>','<input id="focus" style="outline:3px solid black"><script>document.querySelector("input").focus()</script>'),
  pair('control boundary','control-boundary-contrast-low','<input style="border:1px solid #ccc;background:white">','<input style="border:1px solid black;background:white">'),
  pair('named SVG icon','svg-icon-contrast-low','<svg role="img" aria-label="Status" width="40" height="40"><rect width="40" height="40" fill="#ccc"/></svg>','<svg role="img" aria-label="Status" width="40" height="40"><rect width="40" height="40" fill="black"/></svg>'),
  pair('opaque child excludes ancestor gradient','color-inspection-incomplete','<section style="background:linear-gradient(white,black)"><p>Uncertain backdrop</p></section>','<section style="background:linear-gradient(white,black)"><p style="background:white">Opaque backdrop</p></section>')
]
