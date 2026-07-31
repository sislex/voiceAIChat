// Мосты `window.*` для Storybook: декоратор подставляет те же фейки, на которых
// стоят dom-тесты (`fakeApi.ts`), поэтому **ни одна сториз не ходит в сеть** —
// компоненту просто некуда: транспорта в нём нет, есть только мост.
//
// Мосты ставятся во время рендера, а не в эффекте: экраны дергают `window.ci`
// из своих `useEffect`, а эффекты декоратора выполняются уже ПОСЛЕ дочерних.
// Отсюда `useState`-инициализатор — он срабатывает до рендера детей.

import { useState, type ReactNode } from 'react'
import type { Decorator } from '@storybook/react'
import type {
  RendererAgentsBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererPtyBridge
} from '@shared/ipc'
import type { AgentInfo } from '@shared/agentProtocol'
import { createFakeApi, createFakeCi, type FakeApi, type FakeCi } from './fakeApi'
import { createFakePty, makeMachineOps, PLOT_SVG_BASE64 } from './fixtures/machines'

/** Набор мостов, доступных сториз: те же формы, что в web и desktop. */
export interface StoryBridges {
  api: FakeApi
  ci: FakeCi
  fs: RendererFsBridge
  files: RendererFilesBridge
  agents: RendererAgentsBridge
  pty: RendererPtyBridge
}

/** Настройка мостов конкретной сториз: засеять команды, лог, ответы. */
export type BridgeSetup = (bridges: StoryBridges) => void

/** Живой список машин: сториз отдаёт свой набор без WS. */
function fakeAgentsBridge(agents: AgentInfo[]): RendererAgentsBridge {
  return {
    onChange: (cb) => {
      // Как настоящий мост: сразу отдаём снимок, затем «обновлений» нет.
      const id = setTimeout(() => cb(agents), 0)
      return () => clearTimeout(id)
    }
  }
}

/** Создаёт и ставит на `window` полный набор фейковых мостов. */
export function installStoryBridges(setup?: BridgeSetup, agents: AgentInfo[] = []): StoryBridges {
  const ops = makeMachineOps()
  const bridges: StoryBridges = {
    api: createFakeApi(),
    ci: createFakeCi(),
    fs: {
      list: ops.list,
      read: ops.read,
      write: ops.write,
      remove: ops.remove,
      rename: ops.rename,
      mkdir: ops.mkdir,
      exec: ops.exec
    },
    // Картинку, созданную самим CLI, сервер отдаёт байтами — так же, как в web.
    files: { read: async (path: string) => ({ name: path.split('/').pop() ?? path, dataBase64: PLOT_SVG_BASE64 }) },
    agents: fakeAgentsBridge(agents),
    pty: createFakePty()
  }
  setup?.(bridges)
  window.api = bridges.api
  window.ci = bridges.ci
  window.fs = bridges.fs
  window.files = bridges.files
  window.agents = bridges.agents
  window.pty = bridges.pty
  return bridges
}

function BridgeHost({ setup, agents, children }: { setup?: BridgeSetup; agents?: AgentInfo[]; children: ReactNode }): JSX.Element {
  useState(() => installStoryBridges(setup, agents))
  return <>{children}</>
}

/**
 * Декоратор сториз: ставит фейковые мосты до первого рендера компонента.
 * `setup` получает сами фейки — можно засеять справочник команд, лог рана или
 * подменить отдельный метод (`ci.consoleExec = …`).
 */
export function withBridges(setup?: BridgeSetup, agents?: AgentInfo[]): Decorator {
  return function BridgedStory(Story) {
    return (
      <BridgeHost setup={setup} agents={agents}>
        <Story />
      </BridgeHost>
    )
  }
}
