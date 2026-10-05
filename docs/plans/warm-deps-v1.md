# warm-deps-v1 — повторное использование зависимостей в задачах воркеров

Ран `warm-deps-v1`. Идёт параллельно с `task-metrics-v1`.

Кэш `node_modules` воркера (`src/worker/warm-workspace.ts` в Delivery Control) обходится, если в lock-файле
есть `file:`-зависимость или workspace-ссылка. Во всех продуктовых репозиториях архивы `vendor/*.tgz`
подключены через `file:` (voiceAIChat 25, sislexa-core-ui 21, make 16, sislexa-kanban 18), поэтому каждая
попытка делает `npm ci` с нуля (около 5 минут). Ключ кэша к тому же требует точной версии Node.

## Решения

1. `file:`-архивы внутри репозитория входят в ключ по SHA-256 содержимого, а не отключают кэш. `file:`-каталоги
   вне репозитория и скрипты установки корня по-прежнему отключают кэш.
2. Workspace-пакеты: в ключ входят их `package.json`, в кэш — все каталоги `node_modules` воркспейсов.
3. Совместимость Node — платформа, архитектура, мажорная версия и ABI (`process.versions.modules`), а не
   точная версия.

| B01 | delivery-control | — | Reuse dependencies across worker attempts when the lockfile is unchanged and Node is compatible (src/worker/warm-workspace.ts). Today prepareWithCache bypasses the cache when any lockfile package has `link: true` or a `file:` resolved value, which disables it in every product repository (they vendor owner archives as `file:vendor/*.tgz` and use npm workspaces). Change: (1) `file:` tarballs inside the repository are part of the cache key by SHA-256 of their content (a missing or outside-repository path or a `file:` directory still bypasses); (2) workspace links are allowed: the key includes every workspace package.json, and the cache stores and restores the root node_modules plus every workspace node_modules directory with relative symlinks preserved and the tree digest covering all of them; (3) the Node part of the key is platform, arch, major version and `process.versions.modules` instead of the exact `process.version`; (4) root lifecycle scripts and workspace lifecycle scripts (preinstall/install/postinstall/prepare) still bypass; (5) report the result (`hit`/`miss`/`bypass` with a fixed reason code) in the prepare phase metric. Tests: hit with vendored tarballs and workspaces, miss when a tarball's content changes under the same name, miss on workspace package.json change, hit across a Node patch update, miss across a major/ABI change, bypass on outside-repository file: paths and lifecycle scripts, corrupted cache fallback; update README and docs. |
