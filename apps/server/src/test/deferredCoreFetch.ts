/** Resolve the Core address at request time so peers can bind port 0 before Core is built. */
export function deferredCoreFetch(coreUrl: () => string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin === 'http://core.test') {
      const target = new URL(coreUrl())
      url.host = target.host
      url.protocol = target.protocol
    }
    return fetch(input instanceof Request ? new Request(url, input) : url, init)
  }
}
