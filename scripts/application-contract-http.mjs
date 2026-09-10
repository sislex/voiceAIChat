import assert from 'node:assert/strict'
export function contractHttp(token) {
  return async (
    base,
    path,
    { method = 'GET', body, auth = token, status = 200, binary = false } = {}
  ) => {
    assert.ok(base, 'В матрице отсутствует адрес сервиса')
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000)
    })
    if (binary) {
      assert.equal(response.status, status, `${method} ${path}`)
      return Buffer.from(await response.arrayBuffer())
    }
    const text = await response.text()
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${text.slice(0, 1000)}`
    )
    return text ? JSON.parse(text) : null
  }
}
