// Готовые команды установки агента — общий блок для настроек и попапа «Машины».
//
// Смысл: строка подключения (с токеном) показывается один раз, поэтому вместе с
// ней сразу даём команду на каждую ОС. Команда идемпотентна — та же строка потом
// служит и для обновления, поэтому отдельного «обновляющего» набора кнопок нет.

import { useState } from 'react'
import { toDataURL as qrToDataUrl } from 'qrcode'
import {
  AGENT_OS_LIST,
  installCommand,
  serverBaseFromConnection,
  type AgentOs
} from '@shared/agentInstall'
import { Button } from './ui/Button'
import { copyText } from '../lib/clipboard'

export interface AgentCommandsProps {
  /** Имя созданной машины — для заголовка. */
  name: string
  /** Токен машины (виден только сразу после создания/перевыпуска). */
  token: string
  /** Строка подключения по токену (её собирает сервер: адрес + токен). */
  onGetConnectionString: (token: string) => Promise<string | null>
  /** Скрыть блок. */
  onHide?: () => void
}

/** Что скопировали последним — для галочки на кнопке. */
type Copied = AgentOs | 'conn' | 'token' | null

export function AgentCommands({
  name,
  token,
  onGetConnectionString,
  onHide
}: AgentCommandsProps): JSX.Element {
  const [copied, setCopied] = useState<Copied>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  const mark = (what: Copied, ok: boolean): void => {
    setCopied(ok ? what : null)
    setError(ok ? null : 'Не удалось скопировать — выделите текст вручную')
    if (ok) setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000)
  }

  const copyCommand = async (os: AgentOs): Promise<void> => {
    const conn = await onGetConnectionString(token)
    const base = conn ? serverBaseFromConnection(conn) : null
    if (!conn || !base) {
      setError('Не удалось собрать команду: сервер не отдал строку подключения')
      return
    }
    mark(os, await copyText(installCommand(os, base, conn)))
  }

  const copyConn = async (): Promise<void> => {
    const conn = await onGetConnectionString(token)
    if (!conn) {
      setError('Не удалось получить строку подключения')
      return
    }
    mark('conn', await copyText(conn))
  }

  // QR строки подключения: удобно отсканировать телефоном и вставить в Termux.
  const toggleQr = async (): Promise<void> => {
    if (qr) {
      setQr(null)
      return
    }
    const conn = await onGetConnectionString(token)
    if (!conn) {
      setError('Не удалось получить строку подключения')
      return
    }
    try {
      setQr(await qrToDataUrl(conn, { width: 220, margin: 1 }))
    } catch {
      setError('Не удалось построить QR-код')
    }
  }

  return (
    <div className="agcmd" data-testid="agent-commands">
      <p className="agcmd-head">
        Машина «{name}» готова. Скопируйте команду для нужной ОС и вставьте в терминал —
        она проверит Node.js 22+ (при необходимости поставит), скачает агента и запустит его.
      </p>
      <div className="agcmd-os">
        {AGENT_OS_LIST.map((os) => (
          <Button variant="primary" size="sm"
            key={os.id}
            
            title={`Скопировать команду установки для ${os.name} (${os.shell})`}
            aria-label={`Скопировать команду установки для ${os.name}`}
            onClick={() => void copyCommand(os.id)}
          >
            {copied === os.id ? '✓ скопировано' : `${os.icon} ${os.name}`}
            <span className="agcmd-shell">{os.shell}</span>
          </Button>
        ))}
      </div>
      <div className="agcmd-extra">
        <Button variant="primary" size="sm" title="Скопировать строку подключения" onClick={() => void copyConn()}>
          {copied === 'conn' ? '✓ строка скопирована' : 'Строка подключения'}
        </Button>
        <Button variant="primary" size="sm"
          title="Скопировать только токен машины"
          onClick={() => void copyText(token).then((ok) => mark('token', ok))}
        >
          {copied === 'token' ? '✓ токен скопирован' : 'Только токен'}
        </Button>
        <Button variant="primary" size="sm" title="QR-код строки подключения (отсканировать телефоном)" onClick={() => void toggleQr()}>
          {qr ? 'Скрыть QR' : '▦ QR-код'}
        </Button>
        {onHide && (
          <Button variant="primary" size="sm" title="Скрыть команды" onClick={onHide}>
            Скрыть
          </Button>
        )}
      </div>
      {qr && <img className="agcmd-qr" src={qr} alt="QR-код строки подключения" width={220} height={220} />}
      {error && (
        <p className="agcmd-err" role="alert">
          {error}
        </p>
      )}
      <p className="agcmd-note">
        Команда содержит токен машины — не публикуйте её. Токен показывается один раз;
        если он потерялся, перевыпустите его в строке машины.
      </p>
    </div>
  )
}
