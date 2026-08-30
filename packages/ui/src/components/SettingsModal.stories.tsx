import type { Meta, StoryObj } from '@storybook/react'
import { SettingsModal } from './SettingsModal'
import { DEFAULT_SETTINGS } from '@shared/types'

const meta: Meta<typeof SettingsModal> = {
  title: 'Settings/SettingsModal',
  component: SettingsModal,
  args: {
    settings: { ...DEFAULT_SETTINGS },
    mics: [{ deviceId: 'default', label: 'Встроенный микрофон' }],
    voices: [{ id: 'ru_RU-ruslan-medium', label: 'Ruslan — русский (medium)' }],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [{ model: 'large-v3-turbo', present: true, sizeBytes: 1_624_555_275 }],
    capabilities: null,
    mcpServers: [],
    loginStatus: null,
    role: 'admin',
    onDownloadDesktopApp: () => {},
    onDownloadAgentApp: () => {},
    onDownloadAgentScript: () => {},
    onChange: () => {},
    onDownloadVoice: () => {},
    onDeleteVoice: () => {},
    onDeleteModel: () => {},
    onClose: () => {}
  },
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof SettingsModal>

/** Обычное окно: настройки пришли с сервера. */
export const Loaded: Story = {}

/**
 * Настройки не загрузились (сервер в перезапуске — типичное окно деплоя).
 * На экране дефолты, и это состояние обязано быть видно: сохранение сейчас
 * стёрло бы выбор человека, поэтому вместо молчания — баннер с повтором.
 */
export const NotLoaded: Story = {
  args: { settingsLoaded: false, onRetryLoad: () => {} }
}

/**
 * Выбранного голоса нет среди голосов движка (том с голосами ещё не поднялся).
 * Сохранённый выбор остаётся в списке отдельным пунктом, а не подменяется молча.
 */
export const VoiceUnavailable: Story = {
  args: { settings: { ...DEFAULT_SETTINGS, voice: 'ru_RU-dmitri-medium' } }
}
