// Route metadata must not import the settings screen into the main bundle.
export type SettingsSection = 'llm' | 'aiAssist' | 'download' | 'stt' | 'tts' | 'dialog' | 'instructions' | 'storage' | 'security' | 'ui' | 'projectTypes'
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['llm', 'aiAssist', 'download', 'stt', 'tts', 'dialog', 'instructions', 'storage', 'security', 'ui', 'projectTypes']
