import { describe, expect, it } from 'vitest'
import { MAX_CHAT_UPLOAD_BYTES } from '@voicechat/shared/fileStorage'
import { declaredUploadTooLarge } from './uploadBody.js'

const MB = 1024 * 1024

describe('declaredUploadTooLarge', () => {
  it('refuses a raw or multipart body whose declared length already exceeds the attachment limit', () => {
    const raw = declaredUploadTooLarge({ 'content-length': String(MAX_CHAT_UPLOAD_BYTES + 1), 'content-type': 'application/octet-stream' })
    expect(raw).toMatchObject({ code: 'file_too_large', details: { limitBytes: MAX_CHAT_UPLOAD_BYTES } })
    expect(raw?.message).toBe('Файл больше допустимого размера вложения: 32 МБ')
    expect(declaredUploadTooLarge({ 'content-length': String(40 * MB), 'content-type': 'multipart/form-data; boundary=x' })?.code).toBe('file_too_large')
    expect(declaredUploadTooLarge({ 'content-length': String(65 * MB), 'content-type': 'application/json' })?.code).toBe('file_too_large')
  })

  it('lets through a body that may still fit', () => {
    expect(declaredUploadTooLarge({ 'content-length': String(MAX_CHAT_UPLOAD_BYTES), 'content-type': 'image/png' })).toBeNull()
    // Multipart framing and base64 make the body larger than the file itself.
    expect(declaredUploadTooLarge({ 'content-length': String(MAX_CHAT_UPLOAD_BYTES + 1000), 'content-type': 'multipart/form-data; boundary=x' })).toBeNull()
    expect(declaredUploadTooLarge({ 'content-length': String(40 * MB), 'content-type': 'application/json' })).toBeNull()
    expect(declaredUploadTooLarge({})).toBeNull()
    expect(declaredUploadTooLarge({ 'content-length': 'abc' })).toBeNull()
  })
})
