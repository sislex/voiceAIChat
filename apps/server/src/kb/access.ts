// Контроль доступа к базе знаний: собирает «вид» (KbView) пользователя и
// проверяет право писать в раздел. Один модуль на все входы (REST, MCP-инструмент
// модели, авто-инъекция контекста хода) — иначе правила разъедутся между ними.

import type { FastifyRequest } from 'fastify'
import { isKbScope, type KbScope } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { KbView } from './types.js'

/** Вид пользователя: его проекты + необязательные фильтры вкладки UI. */
export function kbViewOf(db: VoiceChatDb, userId: string, filter: { scope?: string | null; projectId?: string | null } = {}): KbView {
  const scope = isKbScope(filter.scope) ? filter.scope : undefined
  return {
    userId,
    projectIds: db.projects.listProjects(userId).map((project) => project.id),
    ...(scope ? { scope } : {}),
    ...(filter.projectId ? { projectId: filter.projectId } : {})
  }
}

export function kbViewOfRequest(db: VoiceChatDb, req: FastifyRequest, filter: { scope?: string | null; projectId?: string | null } = {}): KbView {
  return kbViewOf(db, uid(req), filter)
}

/** Вид для хода модели: проекты владельца чата (чат может быть и без проекта). */
export function kbViewOfTurn(db: VoiceChatDb, userId: string): KbView {
  return kbViewOf(db, userId)
}

/**
 * Право записи в раздел: «Использование» — только админ (общий для всех текст),
 * персональное — сам пользователь, проектное — участник проекта. Возвращает
 * причину отказа или null, если можно.
 */
export function kbWriteDenial(
  db: VoiceChatDb,
  user: { name: string; role: string },
  target: { scope: KbScope; projectId?: string | null }
): string | null {
  if (target.scope === 'usage') return user.role === 'admin' ? null : 'раздел «Использование» правит только администратор'
  if (target.scope === 'user') return null
  if (!target.projectId) return 'для проектной статьи нужен projectId'
  return db.projects.getProject(user.name, target.projectId) ? null : 'нет доступа к проекту'
}
