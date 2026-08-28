// Каталог результатов чата: куда именно на машине ложатся вложения, артефакты и картинки.
// Показывает абсолютный путь, копирует его и открывает проводник машины в этом каталоге —
// чтобы пользователь не гадал, где искать сохранённые файлы (см. machines-roadmap п.7).
import { useState } from 'react'
import type { ChatStorageView } from '@shared/projects'
import { copyText } from '../lib/clipboard'

export interface ChatStorageCardProps {
  storage: ChatStorageView | null | undefined
  machineName?: string
  /** Открыть проводник машины в каталоге (нет — кнопка скрыта). */
  onOpenExplorer?: (agentId: string, path: string) => void
  /** Компактный вид — чип в шапке чата. */
  compact?: boolean
}

const STATUS_LABEL: Record<NonNullable<ChatStorageView['status']>, string> = {
  ready: 'доступно', 'read-only': 'только чтение', offline: 'машина офлайн', unavailable: 'недоступно'
}

export function ChatStorageCard({ storage, machineName, onOpenExplorer, compact }: ChatStorageCardProps) {
  const [copied, setCopied] = useState(false)
  if (!storage) {
    return compact ? null : <p className="convsettings-muted" data-testid="chat-storage-empty">Каталог результатов появится после первой записи файла: чат сам привяжется к хранилищу ChatAI машины.</p>
  }
  const path = storage.directories?.chatRoot ?? (storage.rootPath ? `${storage.rootPath}/${storage.relativePath}` : storage.relativePath)
  const online = storage.status !== 'offline'
  const copy = async () => {
    if (await copyText(path)) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  const open = onOpenExplorer && online ? () => onOpenExplorer(storage.machineId, path) : undefined
  if (compact) {
    return (
      <button
        type="button"
        className={`chat-storage-chip${online ? '' : ' chat-storage-chip--offline'}`}
        data-testid="chat-storage-chip"
        title={`Каталог результатов: ${path}${storage.status ? ` · ${STATUS_LABEL[storage.status]}` : ''}\nКлик — открыть в проводнике`}
        onClick={open}
        disabled={!open}
      >📁 {storage.relativePath}</button>
    )
  }
  return (
    <div className="chat-storage-card" data-testid="chat-storage-card">
      <div className="chat-storage-path" title={path}><code>{path}</code></div>
      <div className="chat-storage-meta">
        {machineName && <span>Машина: <b>{machineName}</b></span>}
        {storage.status && <span className={`chat-storage-status chat-storage-status--${storage.status}`}>{STATUS_LABEL[storage.status]}</span>}
        {!storage.rootPath && <span role="alert">Хранилище больше не зарегистрировано на машине.</span>}
      </div>
      <div className="chat-storage-actions">
        <button type="button" onClick={() => void copy()}>{copied ? 'Скопировано' : 'Скопировать путь'}</button>
        {onOpenExplorer && <button type="button" onClick={open} disabled={!open} title={online ? undefined : 'Машина офлайн'}>Открыть в проводнике</button>}
      </div>
      {storage.directories && (
        <ul className="chat-storage-dirs">
          <li>Вложения: <code>{storage.directories.attachments}</code></li>
          <li>Артефакты: <code>{storage.directories.artifacts}</code></li>
          <li>Картинки и временные: <code>{storage.directories.generated}</code></li>
        </ul>
      )}
    </div>
  )
}
