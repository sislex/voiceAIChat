/** Отмена удаляет ожидающие действия; уже начатое завершается до следующего. */
export class BrowserCommandQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private generation = 0
  private pending = 0
  owner: 'shared' | 'user' = 'shared'

  get size(): number { return this.pending }

  cancel(): void { this.generation++ }

  control(owner: 'shared' | 'user'): void {
    this.owner = owner
    this.cancel()
  }

  enqueue<T>(actor: 'user' | 'assistant', operation: () => Promise<T>, readOnly = false): Promise<T> {
    if (this.pending >= 128) return Promise.reject(new Error('command_queue_full'))
    const generation = this.generation
    this.pending++
    const result = this.tail.then(async () => {
      if (generation !== this.generation) throw new Error('command_cancelled: Ожидающая команда отменена пользователем')
      if (!readOnly && actor === 'assistant' && this.owner === 'user') throw new Error('human_control: Управление у пользователя. Дождитесь возврата управления модели.')
      return operation()
    })
    this.tail = result.catch(() => undefined)
    return result.finally(() => { this.pending-- })
  }

}
