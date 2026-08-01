// Совместимость тестов и старых импортов: локальная реализация CLI переехала
// в apps/llm-runner, сервер использует её через workspace export.

export { ClaudeCli, claudeArgs, type ClaudeCliOptions, type SpawnFn } from '@voicechat/llm-runner/cli'
