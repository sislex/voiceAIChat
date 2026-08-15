// Сториз экрана ошибки: короткое сообщение, техническая деталь под «Подробнее»
// и «Повторить». Без него ошибка чтения выглядела как пустой список.
import type { Meta, StoryObj } from '@storybook/react'
import { ErrorState } from '@voicechat/ui-kit'

const meta: Meta<typeof ErrorState> = {
  title: 'UI/ErrorState',
  component: ErrorState,
  args: { message: 'Не удалось загрузить доску', onRetry: () => {} }
}
export default meta
type Story = StoryObj<typeof ErrorState>

/** Обычный вид: сообщение и «Повторить». */
export const Default: Story = {}

/** С технической деталью — раскрывается по «Подробнее». */
export const WithDetail: Story = {
  args: { detail: 'TypeError: Failed to fetch\n  at httpApi (remote/httpApi.ts:42)' }
}

/** Без «Повторить»: операция не идемпотентна, повтор сделал бы дубль. */
export const WithoutRetry: Story = {
  args: { message: 'Ран не запустился', detail: 'CI: очередь проекта занята', onRetry: undefined }
}

/** Плотный вариант — баннер над уже показанными данными. */
export const CompactBanner: Story = {
  args: { compact: true, message: 'Список мог устареть: обновить не удалось', detail: 'HTTP 503' }
}
