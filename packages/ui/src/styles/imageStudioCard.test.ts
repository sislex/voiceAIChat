// @vitest-environment node
//
// Раскладку карточки галереи в jsdom не измерить (layout там нет), а живьём
// имя файла уже пропадало: восемь кнопок действий в одной flex-строке с ним
// съедали всю ширину карточки, и `.image-studio-name` получал 0 px.
import { describe, expect, it } from 'vitest'
import { decl } from './cssRules'

describe('app.css — карточка студии картинок', () => {
  it('имя файла стоит своей строкой и не сжимается кнопками', () => {
    expect(decl('.image-studio-meta', 'display')).toBe('grid')
    // `flex: 1` у имени вернёт баг: в строке с кнопками оно ужмётся до нуля.
    expect(decl('.image-studio-name', 'flex')).toBeNull()
    expect(decl('.image-studio-name', 'min-width')).toBe('0')
    expect(decl('.image-studio-name', 'text-overflow')).toBe('ellipsis')
  })

  it('ряд действий переносится, а не выталкивает соседей', () => {
    expect(decl('.image-studio-card-actions', 'flex-wrap')).toBe('wrap')
  })
})

describe('app.css — лайтбокс студии', () => {
  it('картинка стоит по центру окна, а не в левом верхнем углу', () => {
    // Кадр 400×300 в окне на 940 прижимался влево-вверх и читался как «сломалось».
    expect(decl('.imgbody > .image-studio-zoom-stage', 'margin-inline')).toBe('auto')
    expect(decl('.util-embed--img .imgbody', 'flex')).toBe('1 1 auto')
    expect(decl('.util-embed--img .imgbody > .image-studio-zoom-stage', 'margin-block')).toBe('auto')
  })

  it('центрируется только сцена, а не всё тело лайтбокса', () => {
    // `align-items: center` на `.imgbody` уводил по центру панель свойств,
    // подсказки и строку меты — поймано глазами в браузере.
    expect(decl('.imgbody', 'align-items')).toBeNull()
  })

  it('кнопки-ссылки в свойствах выровнены по левому краю', () => {
    // Прямые ячейки грида растягиваются, и подпись кнопки встаёт по центру —
    // рядом с левыми «Показать палитру»/«Показать гистограмму» это разнобой.
    expect(decl('.image-studio-props > .image-studio-cancel', 'justify-self')).toBe('start')
  })

  it('длинное имя файла в шапке обрезается, а не распирает её', () => {
    expect(decl('.util-embed--img .mdh', 'text-overflow')).toBe('ellipsis')
    expect(decl('.util-embed--img .mdh', 'white-space')).toBe('nowrap')
  })
})
