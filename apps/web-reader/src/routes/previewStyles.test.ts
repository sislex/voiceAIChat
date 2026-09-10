import { describe, expect, it } from 'vitest'
import { rewritePreviewCss, rewritePreviewSrcset } from './previewStyles.js'
import { rewritePreviewBody } from './previewProxy.js'

const base = new URL('https://example.test/assets/styles/main.css')
const proxy = (value: string, from: URL) => {
  const target = new URL(value, from)
  return /^https?:$/.test(target.protocol) ? '/api/preview?url=' + encodeURIComponent(target.toString()) : value
}
const css = (input: string) => rewritePreviewCss(input, base, proxy)
const srcset = (input: string) => rewritePreviewSrcset(input, base, proxy)

describe('Reader: CSS и srcset без повреждения синтаксиса', () => {
  it('quoted url со скобкой переписывается целиком', () => {
    expect(css('a{background:url("../img/a)b.png")}')).toBe('a{background:url("' + proxy('../img/a)b.png', base) + '")}')
  })
  it('декодирует CSS hex escapes в URL', () => {
    expect(css(String.raw`a{background:url("../img/\66 oo.png")}`)).toContain(proxy('../img/foo.png', base))
  })
  it('не меняет комментарий с url', () => {
    const source = '/* background: url(secret.png) */ a { color: red }'
    expect(css(source)).toBe(source)
  })
  it('не меняет текст content', () => {
    const source = 'a::before { content: "url(secret.png)" }'
    expect(css(source)).toBe(source)
  })
  it('переписывает quoted @import с media и layer', () => {
    expect(css('@import "./theme.css" layer(theme) screen;')).toBe('@import "' + proxy('./theme.css', base) + '" layer(theme) screen;')
  })
  it('переписывает image-set strings, сохраняя type и плотности', () => {
    const result = css('a{background:image-set("a.png" type("image/png") 1x, url(b.png) 2x)}')
    expect(result).toContain(proxy('a.png', base)); expect(result).toContain(proxy('b.png', base)); expect(result).toContain('type("image/png") 1x')
  })
  it('сохраняет fragment-only SVG ресурсы и data URL', () => {
    const source = 'a{filter:url(#filter);background:url("data:image/png;base64,abc")}'; expect(css(source)).toBe(source)
  })
  it('не разбивает data URL в srcset', () => {
    expect(srcset('data:image/png;base64,AAAA 1x, ./two.png 2x')).toBe('data:image/png;base64,AAAA 1x, ' + proxy('./two.png', base) + ' 2x')
  })
  it('сохраняет запятые в имени ресурса srcset и whitespace дескрипторов', () => {
    expect(srcset('  ./a,b.png  640w,\n./large.png 1280w')).toBe('  ' + proxy('./a,b.png', base) + '  640w,\n' + proxy('./large.png', base) + ' 1280w')
  })
  it('переписывает imagesrcset preload и srcset source тем же разбором', () => {
    const html = rewritePreviewBody(Buffer.from('<link rel="preload" as="image" imagesrcset="small.png 1x, large.png 2x"><picture><source srcset="small.png 1x"></picture>'), 'text/html', base).toString()
    expect(html).toContain('imagesrcset="' + proxy('small.png', base) + ' 1x, ' + proxy('large.png', base) + ' 2x"')
    expect(html).toContain('srcset="' + proxy('small.png', base) + ' 1x"')
  })
  it('при повреждённом CSS сохраняет исходник', () => {
    expect(css('a{background:url("unfinished')).toBe('a{background:url("unfinished')
  })
})
