# Многостадийный образ voiceAIChat: Fastify-сервер (apps/server) + web-билд
# (apps/web) на одном порту, плюс claude/codex CLI.
#
# Особенности этого репозитория:
#  • сервер НЕ компилируется в JS — запускается через tsx прямо из исходников
#    и резолвит @voicechat/shared из .ts (workspace-симлинки). Поэтому в runtime
#    нужны исходники + node_modules + tsx, а не dist/.
#  • better-sqlite3 — нативный модуль → в стадии сборки нужен toolchain
#    (python3/make/g++). glibc (bookworm), не musl.
#  • web собирается БЕЗ VITE_SERVER_URL → тот же origin/порт, что и API.

# ---- Стадия сборки -------------------------------------------------------
FROM node:22-bookworm AS build
WORKDIR /app

# Toolchain для сборки better-sqlite3 (node-gyp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Устанавливаем зависимости (все воркспейсы, нативная сборка better-sqlite3,
# симлинки @voicechat/*). Копируем весь репозиторий — .dockerignore отсекает
# лишнее (node_modules, dist, desktop, .git).
COPY . .
RUN npm ci

# Сборка web (same-origin: VITE_SERVER_URL НЕ задаём) → apps/web/dist.
RUN npm run -w @voicechat/web build

# ---- Runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    HOME=/root \
    VC_DATA_DIR=/data \
    VC_WEB_DIR=/app/apps/web/dist

# claude/codex CLI: сервер вызывает их как бинарники `claude`/`codex` из PATH.
# Аутентификация — через смонтированные ~/.claude и ~/.codex (см. compose).
RUN npm i -g @anthropic-ai/claude-code @openai/codex

# Переносим готовое дерево из стадии сборки: исходники + node_modules (с нативным
# better-sqlite3 под glibc) + собранный web.
COPY --from=build /app /app

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787

# Старт сервера (tsx src/index.ts в воркспейсе @voicechat/server).
CMD ["npm", "run", "-w", "@voicechat/server", "start"]
