import { describe, expect, it, vi } from 'vitest'
import { createStoreCore } from './createStore'
import { REDACTED, createReduxDevToolsDiagnostics, sanitizeDevToolsState } from './devtools'

function fixture(mode: 'development' | 'production' = 'development', enabled = false) {
  const connection = { init: vi.fn(), send: vi.fn(), disconnect: vi.fn() }
  const connect = vi.fn(() => connection)
  const core = createStoreCore({ count: 0, accessToken: 'secret' })
  const raw = {
    getState: core.getState, subscribe: core.subscribe,
    actions: { increment: () => core.setState({ count: core.getState().count + 1 }) },
    dispose: core.dispose
  }
  const store = createReduxDevToolsDiagnostics({
    mode, explicitlyEnabled: enabled, extension: { connect }
  }).attach(raw, 'ChatAI Test', 'test')
  return { store, connection, connect }
}

describe('Redux DevTools diagnostics', () => {
  it('publishes named sanitized snapshots', () => {
    const { store, connection, connect } = fixture()
    store.actions.increment()
    expect(connect).toHaveBeenCalledWith({ name: 'ChatAI Test' })
    expect(connection.init).toHaveBeenCalledWith({ count: 0, accessToken: REDACTED })
    expect(connection.send).toHaveBeenCalledWith('test/increment', { count: 1, accessToken: REDACTED })
  })

  it('uses safe production opt-in and disconnects once', () => {
    expect(fixture('production').connect).not.toHaveBeenCalled()
    expect(fixture('production', true).connect).toHaveBeenCalledOnce()
    const { store, connection } = fixture()
    store.dispose()
    store.dispose()
    store.actions.increment()
    expect(connection.disconnect).toHaveBeenCalledOnce()
    expect(connection.send).not.toHaveBeenCalled()
  })

  it('isolates missing and throwing extensions', () => {
    const core = createStoreCore({ count: 0 })
    const raw = { getState: core.getState, subscribe: core.subscribe, actions: { go: () => core.setState({ count: 1 }) }, dispose: core.dispose }
    const absent = createReduxDevToolsDiagnostics({ mode: 'development' }).attach(raw, 'x', 'x')
    expect(() => absent.actions.go()).not.toThrow()
    const broken = createReduxDevToolsDiagnostics({
      mode: 'development', extension: { connect: () => { throw new Error('broken') } }
    }).attach(raw, 'x', 'x')
    expect(() => broken.actions.go()).not.toThrow()
  })
})

describe('sanitizeDevToolsState', () => {
  it('redacts secrets, bounds streams and binaries without mutation', () => {
    const input = {
      nested: { Password: 'pw', refresh_token: 'rt', apiKey: 'key', Authorization: 'Bearer x' },
      streamingReply: 'x'.repeat(700),
      messages: Array.from({ length: 80 }, (_, id) => ({ id })),
      bytes: new Uint8Array([1, 2, 3])
    }
    const snapshot = sanitizeDevToolsState(input) as Record<string, unknown>
    expect(snapshot.nested).toEqual({ Password: REDACTED, refresh_token: REDACTED, apiKey: REDACTED, Authorization: REDACTED })
    expect((snapshot.streamingReply as string).length).toBeLessThan(700)
    expect(snapshot.messages).toHaveLength(51)
    expect(snapshot.bytes).toBe('[Uint8Array omitted: 3 bytes]')
    expect(input.nested.Password).toBe('pw')
  })

  it('handles cycles', () => {
    const input: Record<string, unknown> = {}
    input.self = input
    expect(sanitizeDevToolsState(input)).toEqual({ self: '[circular]' })
  })
})

/*
  "name": "@voicechat/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles/global.css",
    "./app.css": "./src/styles/app.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run --silent",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build -o storybook-static"
  },
  "dependencies": {
    "@codesandbox/sandpack-react": "^2.20.0",
    "@voicechat/admin-app": "*",
    "@voicechat/app-shell": "*",
    "@voicechat/chat-app": "*",
    "@voicechat/operations-app": "*",
    "@voicechat/web-reader-app": "*",
    "@voicechat/playwright-reader-app": "*",
    "@voicechat/projects-app": "*",
    "@voicechat/shared": "*",
    "@voicechat/ui-kit": "*",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "highlight.js": "^11.10.0",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.1.0",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.1"
  },
  "devDependencies": {
    "@storybook/addon-a11y": "^8.6.18",
    "@storybook/addon-essentials": "^8.6.14",
    "@storybook/react": "^8.6.14",
    "@storybook/react-vite": "^8.6.14",
    "@storybook/test": "^8.6.18",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "axe-core": "^4.12.1",
    "jsdom": "^25.0.1",
    "storybook": "^8.6.14",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
*/
