import { describe, expect, it } from 'vitest'
import { PREVIEW_WIDTH_DEFAULT, PREVIEW_WIDTH_MAX, PREVIEW_WIDTH_MIN, clampPreviewWidth, previewWidthAfterKey, splitAttentionReducer } from './readerSplitControls'

describe('previewWidthAfterKey', () => {
  it('moves the divider by steps, jumps to limits and resets on Enter', () => {
    expect(previewWidthAfterKey(45, 'ArrowLeft')).toBe(47)
    expect(previewWidthAfterKey(45, 'ArrowRight')).toBe(43)
    expect(previewWidthAfterKey(45, 'ArrowLeft', true)).toBe(55)
    expect(previewWidthAfterKey(45, 'Home')).toBe(PREVIEW_WIDTH_MIN)
    expect(previewWidthAfterKey(45, 'End')).toBe(PREVIEW_WIDTH_MAX)
    expect(previewWidthAfterKey(60, 'Enter')).toBe(PREVIEW_WIDTH_DEFAULT)
    expect(previewWidthAfterKey(45, 'Tab')).toBeNull()
  })
  it('never leaves the allowed range', () => {
    expect(previewWidthAfterKey(PREVIEW_WIDTH_MAX, 'ArrowLeft')).toBe(PREVIEW_WIDTH_MAX)
    expect(previewWidthAfterKey(PREVIEW_WIDTH_MIN, 'ArrowRight')).toBe(PREVIEW_WIDTH_MIN)
    expect(clampPreviewWidth(Number.NaN)).toBe(PREVIEW_WIDTH_DEFAULT)
    expect(clampPreviewWidth(500)).toBe(PREVIEW_WIDTH_MAX)
  })
})

describe('splitAttentionReducer', () => {
  it('marks the site tab when the model acts while the chat is shown, and clears on switch', () => {
    expect(splitAttentionReducer(null, { type: 'reader-changed', view: 'chat' })).toBe('preview')
    expect(splitAttentionReducer(null, { type: 'reader-changed', view: 'preview' })).toBeNull()
    expect(splitAttentionReducer('preview', { type: 'switch', view: 'preview' })).toBeNull()
    expect(splitAttentionReducer('preview', { type: 'switch', view: 'chat' })).toBe('preview')
  })
  it('marks the chat tab for replies while the site is shown and resets per conversation', () => {
    expect(splitAttentionReducer(null, { type: 'assistant-reply', view: 'preview' })).toBe('chat')
    expect(splitAttentionReducer(null, { type: 'assistant-reply', view: 'chat' })).toBeNull()
    expect(splitAttentionReducer('chat', { type: 'conversation' })).toBeNull()
  })
})
