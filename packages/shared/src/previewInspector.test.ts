import { describe, expect, it } from 'vitest'
import { PREVIEW_INSPECTOR_HTML_LIMIT, PREVIEW_INSPECTOR_MESSAGE_TYPE, isPreviewElementMessage } from './previewInspector'

const valid = () => ({
  type: PREVIEW_INSPECTOR_MESSAGE_TYPE,
  payload: {
    tag: 'button', id: 'save', classes: ['primary'], dataAttributes: { 'data-id': '42' },
    selector: '#save', ancestors: ['html', 'body', 'button#save'],
    rect: { x: 1, y: 2, top: 2, right: 101, bottom: 42, left: 1, width: 100, height: 40 },
    pageUrl: 'https://example.test/page', viewport: { width: 1280, height: 720 },
    outerHTML: '<button id="save">Save</button>', text: 'Save',
    styles: {
      font: '16px sans-serif', color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)',
      margin: '0px', padding: '8px', border: '1px solid', width: '100px', height: '40px',
      position: 'static', display: 'flex', flex: '0 1 auto', flexDirection: 'row', flexWrap: 'nowrap',
      alignItems: 'center', justifyContent: 'center', gap: '0px', grid: 'none',
      gridTemplateColumns: 'none', gridTemplateRows: 'none', gridArea: 'auto'
    }
  }
})

describe('preview inspector message', () => {
  it('валидирует полную runtime-схему', () => expect(isPreviewElementMessage(valid())).toBe(true))
  it('отклоняет неверный тип, числа и превышение лимита HTML', () => {
    expect(isPreviewElementMessage({ ...valid(), type: 'preview.selected' })).toBe(false)
    const badRect = valid(); badRect.payload.rect.width = Number.NaN
    expect(isPreviewElementMessage(badRect)).toBe(false)
    const oversized = valid(); oversized.payload.outerHTML = 'x'.repeat(PREVIEW_INSPECTOR_HTML_LIMIT + 1)
    expect(isPreviewElementMessage(oversized)).toBe(false)
  })
})
