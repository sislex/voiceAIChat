const prose = 'Understanding typography requires comparing the rendered words with the intended experience. Readability depends on spacing, line length, font loading, and the surrounding interface. '
const document = (body: string, css = '') => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Typography fixture</title><style>body{margin:8px;font:16px/1.5 Arial,sans-serif}main{width:700px;max-width:100%}${css}</style></head><body><main>${body}</main><script>addEventListener('load',()=>document.documentElement.dataset.auditReady='yes')</script></body></html>`
const styled = (rule: string, broken: string, fixed: string, text = 'Readable sample text') => ({ rule, broken: document('<p style="'+broken+'">'+text+'</p>'), fixed: document('<p style="'+fixed+'">'+text+'</p>') })
const pair = (rule: string, broken: string, fixed: string) => ({ rule, broken: document(broken), fixed: document(fixed) })
export const typographyAuditFixtures = [
  styled('small-font-text', 'font-size:8px', 'font-size:16px'),
  styled('zero-font-text', 'font-size:0', 'font-size:16px'),
  styled('zero-line-height', 'line-height:0', 'line-height:1.5'),
  styled('tight-line-height', 'font-size:20px;line-height:12px', 'font-size:20px;line-height:30px'),
  styled('tight-letter-spacing', 'letter-spacing:-3px', 'letter-spacing:0'),
  styled('tight-word-spacing', 'word-spacing:-5px', 'word-spacing:0'),
  styled('transparent-text', 'color:transparent', 'color:black'),
  styled('nowrap-text-overflow', 'white-space:nowrap;width:80px', 'white-space:normal;width:80px'),
  styled('ellipsis-truncates-text', 'white-space:nowrap;width:80px;overflow:hidden;text-overflow:ellipsis', 'white-space:nowrap;width:400px;overflow:hidden;text-overflow:ellipsis'),
  styled('line-clamp-truncates-text', 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;width:200px', 'width:200px', prose),
  styled('uppercase-long-passage', 'text-transform:uppercase', 'text-transform:none', prose),
  styled('capitalize-long-passage', 'text-transform:capitalize', 'text-transform:none', prose),
  styled('wide-text-measure', 'width:1400px', 'width:600px', prose),
  styled('narrow-text-measure', 'width:80px', 'width:400px', prose),
  styled('justified-narrow-prose', 'text-align:justify;width:240px', 'text-align:justify;width:400px', prose),
  styled('font-generic-fallback-missing', 'font-family:Arial', 'font-family:Arial,sans-serif'),
  { rule: 'font-face-load-error', ready: "document.documentElement.dataset.auditReady==='yes'", broken: document('<p style="font-family:Broken,sans-serif">Font failure</p>', '@font-face{font-family:Broken;src:url(data:font/woff;base64,AAAA)}'), fixed: document('<p>Font available</p>') },
  styled('break-all-prose', 'word-break:break-all', 'word-break:normal', prose+' Uncharacteristically long words.'),
  styled('thin-small-text', 'font-size:12px;font-weight:100', 'font-size:12px;font-weight:400'),
  styled('heavy-text-stroke', '-webkit-text-stroke:4px black', '-webkit-text-stroke:0 black'),
  styled('long-unbreakable-token', 'overflow-wrap:normal', 'overflow-wrap:anywhere', 'x'.repeat(80)),
  styled('prose-selection-disabled', 'user-select:none', 'user-select:text', prose),
  styled('text-indent-outside-box', 'width:200px;text-indent:-9999px', 'width:200px;text-indent:0'),
  pair('bidi-control-characters', '<p>Amount \u202e123\u202c</p>', '<p>Amount 123</p>'),
  pair('invisible-characters-only', '<p>\u200b\u200c</p>', '<p>Visible label</p>'),
  pair('inline-link-cue-missing', '<p>Read <a href="#details" style="color:inherit;text-decoration:none">details</a>.</p>', '<p>Read <a href="#details" style="color:inherit;text-decoration:underline">details</a>.</p>'),
  pair('outside-list-marker-clipped', '<ul style="overflow:hidden;padding-inline-start:0"><li>Item</li></ul>', '<ul style="overflow:hidden;padding-inline-start:40px"><li>Item</li></ul>'),
  pair('replacement-character-text', '<p>Broken \ufffd text</p>', '<p>Readable text</p>'),
  pair('raw-template-expression', '<p>Hello {{ user.name }}</p>', '<p>Hello Alex</p>'),
  pair('mojibake-text-pattern', '<p>caf\u00c3\u00a9 caf\u00c3\u00a9</p>', '<p>caf\u00e9 caf\u00e9</p>')
]
