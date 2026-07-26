import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageImage } from './MessageImage'
import { DEFAULT_AGENT_POLICY, type AgentInfo } from '@shared/agentProtocol'

// 1×1 png — достаточно, чтобы проверить путь «base64 → data-URL → <img src>».
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fakeOps(dataBase64: string = PNG_B64) {
  return { read: vi.fn().mockResolvedValue({ root: '/', cwd: '', name: 'out.png', dataBase64 }) }
}

const IMAGE = { path: '/tmp/out.png' }

/** Сервер такого файла у себя не знает (штатный ответ, не ошибка). */
const noServerFile = () => Promise.resolve(null)

describe('MessageImage — загрузка картинки с машины', () => {
  it('читает файл через ops.read и показывает его как data-URL', async () => {
    const ops = fakeOps()
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={ops} readServerFile={noServerFile} />)
    expect(screen.getByTestId('image-loading')).toBeInTheDocument()
    const img = await screen.findByTestId('message-image')
    expect(ops.read).toHaveBeenCalledWith('m1', '/tmp/out.png')
    expect(img).toHaveAttribute('src', `data:image/png;base64,${PNG_B64}`)
  })

  it('кнопка проводника передаёт машину и путь картинки', async () => {
    const open = vi.fn()
    render(
      <MessageImage
        image={{ path: '/tmp/a.png', agentId: 'm2' }}
        execAgentId="m1"
        ops={fakeOps()}
        readServerFile={noServerFile}
        onOpenInExplorer={open}
      />
    )
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Показать картинку в проводнике'))
    expect(open).toHaveBeenCalledWith('m2', '/tmp/a.png')
  })

  it('agentId из блока важнее машины сообщения', async () => {
    const ops = fakeOps()
    render(<MessageImage image={{ path: '/tmp/a.png', agentId: 'm2' }} execAgentId="m1" ops={ops} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    expect(ops.read).toHaveBeenCalledWith('m2', '/tmp/a.png')
  })

  it('без машины и без файла на сервере — понятная ошибка с путём', async () => {
    const ops = fakeOps()
    render(<MessageImage image={IMAGE} execAgentId={null} ops={ops} readServerFile={noServerFile} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('машина для этого ответа не выбрана')
    expect(screen.getByRole('alert')).toHaveTextContent('/tmp/out.png')
    expect(ops.read).not.toHaveBeenCalled()
  })

  it('execTarget «none» считается отсутствием машины', async () => {
    const ops = fakeOps()
    render(<MessageImage image={IMAGE} execAgentId="none" ops={ops} readServerFile={noServerFile} />)
    await screen.findByRole('alert')
    expect(ops.read).not.toHaveBeenCalled()
  })

  it('ошибка чтения показывается пользователю', async () => {
    const ops = { read: vi.fn().mockRejectedValue(new Error('нет доступа')) }
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={ops} readServerFile={noServerFile} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('нет доступа')
  })

  it('пустой ответ — сообщение вместо битой картинки', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps('')} readServerFile={noServerFile} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Файл пустой или недоступен')
  })

  it('в шапке имя файла, а caption — подпись под картинкой', async () => {
    render(
      <MessageImage
        image={{ path: '/tmp/dir/chart.png', caption: 'График продаж' }}
        execAgentId="m1"
        ops={fakeOps()}
        readServerFile={noServerFile}
      />
    )
    await screen.findByTestId('message-image')
    expect(screen.getByRole('group', { name: 'chart.png' })).toBeInTheDocument()
    expect(screen.getByText('График продаж')).toHaveClass('imgcap')
  })
})

describe('MessageImage — разворот и зум', () => {
  it('клик по превью разворачивает на весь экран, Esc сворачивает', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    expect(screen.queryByTestId('image-surface')).toBeNull()

    await userEvent.click(screen.getByLabelText('Открыть картинку на весь экран'))
    expect(screen.getByTestId('image-surface')).toBeInTheDocument()
    expect(screen.getByTestId('image-embed')).toHaveClass('util-embed--fs')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('image-surface')).toBeNull()
  })

  it('колесо мыши в развороте приближает картинку', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Открыть картинку на весь экран'))

    const surface = screen.getByTestId('image-surface')
    expect(surface.dataset.zoom).toBe('1.00')
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }))
    await waitFor(() => expect(Number(surface.dataset.zoom)).toBeGreaterThan(1))
    expect(surface).toHaveClass('imgsurf--zoomed')
  })

  it('двойной клик приближает, повторный возвращает исходный масштаб', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Открыть картинку на весь экран'))

    const surface = screen.getByTestId('image-surface')
    await userEvent.dblClick(surface)
    expect(surface.dataset.zoom).toBe('2.00')
    await userEvent.dblClick(surface)
    expect(surface.dataset.zoom).toBe('1.00')
  })

  it('после сворачивания масштаб сбрасывается', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Открыть картинку на весь экран'))
    await userEvent.dblClick(screen.getByTestId('image-surface'))
    expect(screen.getByTestId('image-surface').dataset.zoom).toBe('2.00')

    await userEvent.click(screen.getByTitle('Свернуть'))
    await userEvent.click(screen.getByLabelText('Открыть картинку на весь экран'))
    expect(screen.getByTestId('image-surface').dataset.zoom).toBe('1.00')
  })
})

describe('MessageImage — скачивание и копирование', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('кнопка «Скачать» кликает по ссылке с именем файла', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<MessageImage image={{ path: '/tmp/dir/chart.png' }} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')

    await userEvent.click(screen.getByLabelText('Скачать картинку'))
    expect(click).toHaveBeenCalledTimes(1)
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(a.download).toBe('chart.png')
    expect(a.getAttribute('href')).toContain('data:image/png;base64,')
  })

  it('кнопки неактивны, пока картинка не загрузилась', () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    expect(screen.getByLabelText('Скачать картинку')).toBeDisabled()
    expect(screen.getByLabelText('Копировать картинку')).toBeDisabled()
  })

  it('копирование кладёт в буфер картинку нужного MIME-типа', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { write } })
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Копировать картинку'))

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const item = write.mock.calls[0][0][0] as FakeClipboardItem
    expect(item.items['image/png']).toBeInstanceOf(Blob)
    expect(await screen.findByTitle('Копировать картинку')).toHaveTextContent('✓')
    vi.unstubAllGlobals()
  })

  it('буфер недоступен — кнопка сообщает о неудаче', async () => {
    Object.assign(navigator, { clipboard: undefined })
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    await screen.findByTestId('message-image')
    await userEvent.click(screen.getByLabelText('Копировать картинку'))
    expect(await screen.findByTitle('Не удалось скопировать')).toBeInTheDocument()
  })
})

describe('MessageImage — файл на сервере (картинки от CLI)', () => {
  // Регрессия: встроенный генератор Codex пишет png в профиль пользователя НА
  // СЕРВЕРЕ (`<профиль>/.codex/generated_images/…`), даже когда команды хода шли
  // на машину. Чтение только с машины давало «stat ENOENT» вместо картинки.
  const CODEX = { path: '/data/cli-users/YWRtaW4/.codex/generated_images/s/call.png' }

  it('сначала спрашивает сервер и машину уже не трогает', async () => {
    const ops = fakeOps()
    const readServerFile = vi.fn().mockResolvedValue({ name: 'call.png', dataBase64: PNG_B64 })
    render(<MessageImage image={CODEX} execAgentId="m1" ops={ops} readServerFile={readServerFile} />)

    const img = await screen.findByTestId('message-image')
    expect(readServerFile).toHaveBeenCalledWith(CODEX.path)
    expect(img).toHaveAttribute('src', `data:image/png;base64,${PNG_B64}`)
    expect(ops.read).not.toHaveBeenCalled()
  })

  it('сервер не знает файла → читаем с машины хода', async () => {
    const ops = fakeOps()
    const readServerFile = vi.fn().mockResolvedValue(null)
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={ops} readServerFile={readServerFile} />)

    await screen.findByTestId('message-image')
    expect(readServerFile).toHaveBeenCalledWith('/tmp/out.png')
    expect(ops.read).toHaveBeenCalledWith('m1', '/tmp/out.png')
  })

  it('явный agentId в блоке — сервер не спрашиваем вовсе', async () => {
    const ops = fakeOps()
    const readServerFile = vi.fn()
    render(
      <MessageImage
        image={{ path: '/tmp/a.png', agentId: 'm2' }}
        execAgentId="m1"
        ops={ops}
        readServerFile={readServerFile}
      />
    )
    await screen.findByTestId('message-image')
    expect(readServerFile).not.toHaveBeenCalled()
    expect(ops.read).toHaveBeenCalledWith('m2', '/tmp/a.png')
  })

  it('без моста сервера работает по-старому — только машина', async () => {
    const ops = fakeOps()
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={ops} />)
    await screen.findByTestId('message-image')
    expect(ops.read).toHaveBeenCalledWith('m1', '/tmp/out.png')
  })
})

describe('MessageImage — постепенное появление во время генерации', () => {
  // Codex отдаёт только готовый файл (событий с частичными кадрами нет), поэтому
  // «постепенность» = плитка-заглушка, пока файла нет, и проявление после загрузки.
  it('пока ход идёт и файла нет — заглушка «Рисую картинку…», а не ошибка', async () => {
    const ops = { read: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')) }
    render(
      <MessageImage image={IMAGE} execAgentId="m1" ops={ops} readServerFile={noServerFile} live />
    )
    await waitFor(() => expect(ops.read).toHaveBeenCalled())
    expect(screen.getByTestId('image-loading')).toHaveTextContent('Рисую картинку…')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('перечитывает файл, пока ход не завершён, и показывает появившуюся картинку', async () => {
    vi.useFakeTimers()
    try {
      const read = vi
        .fn()
        .mockRejectedValueOnce(new Error('ENOENT: no such file'))
        .mockResolvedValue({ root: '/', cwd: '', dataBase64: PNG_B64 })
      render(
        <MessageImage image={IMAGE} execAgentId="m1" ops={{ read }} readServerFile={noServerFile} live />
      )
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(800) // пауза между попытками
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(screen.getByTestId('message-image')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  it('ход завершён и файла нет — показываем ошибку, а не бесконечную заглушку', async () => {
    const ops = { read: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')) }
    render(
      <MessageImage image={IMAGE} execAgentId="m1" ops={ops} readServerFile={noServerFile} />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('ENOENT')
    expect(ops.read).toHaveBeenCalledTimes(1)
  })

  it('картинка проявляется: до onLoad размыта, после — резкая', async () => {
    render(<MessageImage image={IMAGE} execAgentId="m1" ops={fakeOps()} readServerFile={noServerFile} />)
    const img = await screen.findByTestId('message-image')
    // jsdom не грузит data-URL сам: до события картинка в «размытом» состоянии.
    expect(img).toHaveClass('imgfade')
    expect(img).not.toHaveClass('imgfade--on')
    fireEvent.load(img)
    expect(img).toHaveClass('imgfade--on')
  })
})

describe('MessageImage — картинка отдаётся HTTP-сервером машины', () => {
  const MACHINE = { path: '/home/u/.generated_images/pic.png', agentId: 'm1' }
  const agent = (imageHost?: { port: number; hosts: string[] }): AgentInfo => ({
    id: 'm1',
    name: 'Ноутбук',
    online: true,
    createdAt: 0,
    lastSeen: 0,
    policy: DEFAULT_AGENT_POLICY,
    ...(imageHost ? { imageHost } : {})
  })

  it('src — прямой адрес машины, байты через сервер не тянем', async () => {
    const ops = fakeOps()
    render(
      <MessageImage
        image={MACHINE}
        execAgentId="m1"
        ops={ops}
        agents={[agent({ port: 8788, hosts: ['192.168.1.5'] })]}
      />
    )
    const img = await screen.findByTestId('message-image')
    expect(img).toHaveAttribute('src', 'http://192.168.1.5:8788/pic.png')
    expect(ops.read).not.toHaveBeenCalled()
  })

  it('адрес пересобирается из живого AgentInfo — сменившийся IP подхватывается', async () => {
    const { rerender } = render(
      <MessageImage image={MACHINE} execAgentId="m1" ops={fakeOps()} agents={[agent({ port: 8788, hosts: ['10.0.0.2'] })]} />
    )
    expect((await screen.findByTestId('message-image')).getAttribute('src')).toContain('10.0.0.2')
    rerender(
      <MessageImage image={MACHINE} execAgentId="m1" ops={fakeOps()} agents={[agent({ port: 8788, hosts: ['10.0.0.9'] })]} />
    )
    expect(screen.getByTestId('message-image')).toHaveAttribute('src', 'http://10.0.0.9:8788/pic.png')
  })

  it('первый адрес недоступен → пробуем следующий', async () => {
    render(
      <MessageImage
        image={MACHINE}
        execAgentId="m1"
        ops={fakeOps()}
        agents={[agent({ port: 8788, hosts: ['192.168.1.5', '10.0.0.2'] })]}
      />
    )
    const img = await screen.findByTestId('message-image')
    fireEvent.error(img)
    expect(screen.getByTestId('message-image')).toHaveAttribute('src', 'http://10.0.0.2:8788/pic.png')
  })

  it('все адреса машины недоступны → откат на чтение байтов через сервер', async () => {
    const ops = fakeOps()
    render(
      <MessageImage
        image={MACHINE}
        execAgentId="m1"
        ops={ops}
        agents={[agent({ port: 8788, hosts: ['192.168.1.5'] })]}
      />
    )
    fireEvent.error(await screen.findByTestId('message-image'))
    await waitFor(() => expect(ops.read).toHaveBeenCalledWith('m1', MACHINE.path))
    await waitFor(() =>
      expect(screen.getByTestId('message-image')).toHaveAttribute(
        'src',
        `data:image/png;base64,${PNG_B64}`
      )
    )
  })

  it('машина офлайн или без раздачи → сразу байты через сервер', async () => {
    const ops = fakeOps()
    render(<MessageImage image={MACHINE} execAgentId="m1" ops={ops} agents={[agent()]} />)
    await screen.findByTestId('message-image')
    expect(ops.read).toHaveBeenCalledWith('m1', MACHINE.path)
  })
})
