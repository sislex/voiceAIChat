// Routing metadata must not import the settings UI and its editor dependencies.
export type SettingsSection = 'llm' | 'aiAssist' | 'download' | 'stt' | 'tts' | 'dialog' | 'instructions' | 'storage' | 'security' | 'ui' | 'projectTypes'
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['llm', 'aiAssist', 'download', 'stt', 'tts', 'dialog', 'instructions', 'storage', 'security', 'ui', 'projectTypes']
