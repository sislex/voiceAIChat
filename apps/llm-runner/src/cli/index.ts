// Публичный вход пакета для CLI-части: `@voicechat/llm-runner/cli`.
//
// ВРЕМЕННО им пользуется и сервер (`server.ts`, `routes/rest.ts`): CLI-классы уже
// живут здесь, но сервер ещё зовёт их напрямую. Срез 2 плана
// (`docs/plans/llm-runners.md`) переводит сервер на `RemoteLlmClient` по HTTP, и
// эта зависимость `@voicechat/server` → `@voicechat/llm-runner` уходит.

export { ClaudeCli, claudeArgs, type ClaudeCliOptions, type SpawnFn } from './claudeCli.js'
export { CodexCli, codexInvocation, type CodexCliOptions } from './codexCli.js'
export { killCliChild, CLI_SIGKILL_DELAY_MS } from './childKill.js'
export { listMcpServers, type ExecFileFn } from './mcp.js'
export {
  cliProfileDirs,
  cliProfileEnv,
  ensureCliProfile,
  type CliProfileDirs
} from './cliProfiles.js'
