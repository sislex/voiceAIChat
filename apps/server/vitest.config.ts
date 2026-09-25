import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vite 5 predates Node's sqlite builtin; keep this owner runtime import native.
  plugins: [{
    name: 'native-node-sqlite',
    enforce: 'pre',
    resolveId(id) { if (id === 'node:sqlite' || id === 'sqlite') return '\0native-node-sqlite' },
    load(id) {
      if (id === '\0native-node-sqlite') return "const sqlite = process.getBuiltinModule('node:sqlite'); export const DatabaseSync = sqlite.DatabaseSync; export const StatementSync = sqlite.StatementSync; export const constants = sqlite.constants; export default sqlite;"
    }
  }],
  test: {
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Самый долгий тест пакета — 5 с на свободной машине, но регрессия ходит
    // одновременно с другими прогонами на тех же 8 ядрах, и там прогон
    // деградирует в 7–8 раз (замер: collect 91 с → 621 с, transform 12 с →
    // 95 с). При лимите 30 с это роняло четыре теста в rest.auth и
    // rest.conversations, которые локально идут по две секунды.
    // Шестьдесят секунд — 12-кратный запас; возвращаться к прежним десяти
    // минутам незачем: они маскировали зависший listen/ws вместо быстрого
    // падения, и это соображение остаётся верным.
    testTimeout: 60_000,
    // Hooks поднимают тот же Fastify/SQLite test harness, но Vitest ограничивает
    // их отдельным дефолтом в 10 с. На восьмиядерной release-машине полный gate
    // насыщает CPU и валит несвязанные beforeEach/afterEach ещё до тела теста.
    // Держим для hooks тот же ограниченный запас, что и для самих тестов.
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
      reporter: ['text-summary'],
      // Пороги — «трещотка»: чуть ниже фактического уровня на день замера
      // (85,39% строк, 74,84% ветвей, 84,8% функций). Ветвей заметно меньше
      // строк — это необработанные ветки ошибок в маршрутах и оркестраторах.
      thresholds: { statements: 84, branches: 73, functions: 83, lines: 84 }
    }
  }
})
