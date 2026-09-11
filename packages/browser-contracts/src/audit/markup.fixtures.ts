/** Paired documents prove both detection and the absence of the same issue after repair. */
export interface MarkupAuditFixture { rule: string; broken: string; fixed: string }
const page = (body = '<main><h1>Audit fixture</h1></main>', options: { lang?: string; head?: string; doctype?: boolean } = {}) =>
  `${options.doctype === false ? '' : '<!doctype html>'}<html ${options.lang ?? 'lang="en"'}><head>${options.head ?? '<title>Reader QA</title><meta name="viewport" content="width=device-width,initial-scale=1">'}</head><body>${body}</body></html>`
const pair = (rule: string, broken: string, fixed: string): MarkupAuditFixture => ({ rule, broken: page(broken), fixed: page(fixed) })
export const markupAuditFixtures: MarkupAuditFixture[] = [
  { rule: 'document-language-missing', broken: page(undefined, { lang: '' }), fixed: page() },
  { rule: 'document-language-invalid', broken: page(undefined, { lang: 'lang="en_US"' }), fixed: page(undefined, { lang: 'lang="en-US"' }) },
  { rule: 'document-title-missing', broken: page(undefined, { head: '<title> </title>' }), fixed: page() },
  { rule: 'document-quirks-mode', broken: page(undefined, { doctype: false }), fixed: page() },
  { rule: 'document-viewport-missing', broken: page(undefined, { head: '<title>Reader QA</title>' }), fixed: page() },
  pair('duplicate-id', '<div id="same"></div><span id="same"></span>', '<div id="one"></div><span id="two"></span>'),
  pair('label-target-missing', '<label for="missing">Name</label>', '<label for="name">Name</label><input id="name">'),
  ...(['labelledby', 'describedby', 'controls', 'owns'] as const).map(attr => pair(`aria-${attr}-missing`, `<button aria-${attr}="missing">Open</button>`, `<button aria-${attr}="target">Open</button><span id="target">Panel</span>`)),
  pair('image-alt-missing', '<img src="data:,">', '<img src="data:," alt="">'),
  pair('image-alt-filename', '<img alt="image.png">', '<img alt="Blue mountain at sunrise">'),
  pair('iframe-name-missing', '<iframe srcdoc="hello"></iframe>', '<iframe title="Preview" srcdoc="hello"></iframe>'),
  pair('button-name-missing', '<button></button>', '<button aria-label="Save"><svg></svg></button>'),
  pair('link-name-missing', '<a href="/target"></a>', '<a href="/target" aria-label="Home"></a>'),
  pair('control-name-missing', '<input placeholder="Name">', '<label for="name">Name</label><input id="name">'),
  pair('main-landmark-missing', '<section><h1>Content</h1></section>', '<main><h1>Content</h1></main>'),
  pair('main-landmark-duplicate', '<main>One</main><main>Two</main>', '<main>One</main><main hidden>Two</main>'),
  pair('heading-empty', '<h1></h1>', '<h1>Settings</h1>'),
  pair('heading-level-skip', '<h1>Page</h1><h3>Section</h3>', '<h1>Page</h1><h2>Section</h2>'),
  pair('interactive-nesting', '<a href="/target"><button>Open</button></a>', '<a href="/target">Open</a><button>Save</button>'),
  pair('summary-position', '<details open><p>Content</p><summary>More</summary></details>', '<details open><summary>More</summary><p>Content</p></details>'),
  pair('details-summary-missing', '<details open><p>Content</p></details>', '<details><summary>More</summary><p>Content</p></details>'),
  pair('table-header-missing', '<table><tr><td>Cell</td></tr></table>', '<table><tr><th>Name</th></tr><tr><td>Cell</td></tr></table>'),
  pair('table-header-reference-missing', '<table><tr><td headers="missing">Cell</td></tr></table>', '<table><tr><th id="column">Name</th></tr><tr><td headers="column">Cell</td></tr></table>'),
  pair('list-child-invalid', '<ul><div>Item</div></ul>', '<ul><li>Item</li></ul>'),
  pair('label-target-nonlabelable', '<label for="x">Name</label><div id="x"></div>', '<label for="x">Name</label><input id="x">'),
  pair('aria-hidden-focusable', '<div aria-hidden="true"><button>Hidden button</button></div>', '<div aria-hidden="true" inert><button>Hidden button</button></div>'),
  pair('positive-tabindex', '<button tabindex="2">Save</button>', '<button tabindex="0">Save</button>')
]
