import { expect, it } from 'vitest'
import { signDirect, verifyDirect, type DirectClaims } from './direct.js'

it('bounds capability lifetime and binds every signed claim to the node secret', () => {
  const secret = 'test-direct-secret-32-characters-long'
  const claims: DirectClaims = {blobId: 'blob0000', method: 'PUT', size: 3,
    mimeType: 'text/plain', expiresAt: 300_100, uploadId: 'upload00'}
  const token = signDirect(claims, secret)
  expect(verifyDirect(token, secret, 100)).toEqual(claims)
  expect(() => verifyDirect(token, 'another-node-secret', 100)).toThrow()
  expect(() => verifyDirect(token, secret, 300_100)).toThrow()
  expect(() => verifyDirect(token, secret, 99)).toThrow()
  for (const change of [{blobId: 'different'}, {method: 'GET'}, {size: 4},
    {mimeType: 'image/png'}, {expiresAt: 400_000}, {uploadId: 'upload01'}]) {
    const payload = Buffer.from(JSON.stringify({...claims, ...change})).toString('base64url')
    expect(() => verifyDirect(payload + '.' + token.split('.')[1], secret, 100)).toThrow()
  }
  for (const value of ['broken', token + '.extra', '', 'x'.repeat(4097)])
    expect(() => verifyDirect(value, secret, 100)).toThrow()
})
