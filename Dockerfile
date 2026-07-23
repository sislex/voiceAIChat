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

# ---- Сборка whisper.cpp: whisper-cli для серверного распознавания речи ----
# Статическая линковка (BUILD_SHARED_LIBS=OFF) → в runtime нужен только бинарь
# (+ libgomp1: OpenMP). Без него STT в контейнере не работает вовсе.
FROM debian:bookworm-slim AS whisper
RUN apt-get update \
  && apt-get install -y --no-install-recommends git cmake make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.7.5 https://github.com/ggml-org/whisper.cpp /whisper
RUN cmake -S /whisper -B /whisper/build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /whisper/build -j"$(nproc)" --target whisper-cli

# ---- Runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Работаем под непривилегированным пользователем `node` (есть в базовом образе):
# claude CLI запрещает `--dangerously-skip-permissions` (режим «Полный доступ»)
# под root/sudo. HOME=/home/node → здесь тома ~/.claude и ~/.codex с авторизацией.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    HOME=/home/node \
    VC_DATA_DIR=/data \
    VC_WEB_DIR=/app/apps/web/dist \
    VC_WHISPER_CLI=/usr/local/bin/whisper-cli

# ca-certificates: codex — Rust-бинарь (rustls) и проверяет TLS по системному
#   хранилищу; в slim-образе его нет → без этого запросы к chatgpt.com падают с
#   `invalid peer certificate: UnknownIssuer`.
# bubblewrap: песочница codex на Linux (иначе codex ругается и берёт bundled).
# gosu: старт под root (chown тома) → сброс до node в entrypoint.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates bubblewrap gosu libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# claude/codex CLI: сервер вызывает их как бинарники `claude`/`codex` из PATH.
# Аутентификация — внутри контейнера (тома ~/.claude и ~/.codex, см. compose):
# логин выполняется через `docker compose exec` (см. DOCKER.md).
RUN npm i -g @anthropic-ai/claude-code @openai/codex

# Переносим готовое дерево из стадии сборки: исходники + node_modules (с нативным
# better-sqlite3 под glibc) + собранный web.
COPY --from=build /app /app
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Каталоги данных и авторизации во владении node (SQLite + вложения + токены CLI).
# Создаём каталоги auth в образе → новые именованные тома инициализируются с
# владельцем node (иначе Docker создаст их root-овыми, и node не сможет логиниться).
RUN mkdir -p /data /home/node/.claude /home/node/.codex \
  && chown -R node:node /data /home/node/.claude /home/node/.codex
VOLUME ["/data"]
EXPOSE 8787

# Entrypoint стартует под root (chown тома), затем сбрасывает привилегии до node.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Старт сервера (tsx src/index.ts в воркспейсе @voicechat/server).
CMD ["npm", "run", "-w", "@voicechat/server", "start"]
