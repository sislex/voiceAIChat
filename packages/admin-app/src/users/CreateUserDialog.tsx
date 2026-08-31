// Создание учётной записи — в диалоге, а не формой в подвале списка.
//
// В подвале она соревновалась за внимание со списком людей и уезжала за экран
// при длинном списке; диалог открывается кнопкой «＋ Добавить» из шапки.

import { useState } from 'react'
import type { UserRole } from '@shared/types'
import { Button, Dialog } from '@voicechat/ui-kit'

export interface CreateUserDialogProps {
  onCreate: (name: string, password: string, role: UserRole, mustChangePassword?: boolean) => void
  onClose: () => void
  /**
   * Ошибка сервера по последней попытке. Показывается в форме, а не тостом:
   * тост исчезает через пару секунд, а исправлять пароль человек будет здесь.
   */
  error?: string | null
}

export function CreateUserDialog({ onCreate, onClose, error = null }: CreateUserDialogProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('developer')
  const [newTemp, setNewTemp] = useState(true)

  const submitCreate = (): void => {
    const n = newName.trim()
    if (!n) return
    onCreate(n, newPass, newRole, newTemp)
    // Окно закрывается только когда сервер принял: иначе человек с отказом по
    // политике пароля терял и форму, и введённые данные.
  }

  return (
    <Dialog title="Создать пользователя" size="sm" onClose={onClose} testId="create-user-dialog">
      <div className="ucreate">
        {error && <p className="ucreate-error" role="alert">{error}</p>}
        
        <input className="login-input" placeholder="Логин" aria-label="Логин нового пользователя" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input className="login-input" type="password" placeholder="Пароль — не короче 10 символов" aria-label="Пароль нового пользователя" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
        <select className="sel" aria-label="Роль нового пользователя" value={newRole} onChange={(e) => setNewRole(e.target.value as import('@shared/types').UserRole)}>
          <option value="developer">developer</option>
          <option value="tester">tester</option>
          <option value="observer">observer</option>
          <option value="admin">admin</option>
        </select>
        <label className="make-autosave" title="Пользователь обязан сменить пароль при первом входе"><input type="checkbox" aria-label="Временный пароль" checked={newTemp} onChange={(e) => setNewTemp(e.target.checked)} /> временный пароль</label>
        <Button variant="primary" disabled={!newName.trim()} onClick={submitCreate}>Создать</Button>
      </div>
    </Dialog>
  )
}
