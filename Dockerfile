# Многостадийные образы voiceAIChat:
#  • server-runtime — Fastify-сервер + web-билды ChatAI и Web Recorder
#  • llm-runner-runtime — внутренний исполнитель claude/codex CLI (apps/llm-runner)
#  • stt-runner-runtime — единственный владелец whisper-cli и STT-моделей
#  • automation-runner-runtime — durable execution plane CI/QA/merge
#
# Особенности репозитория:
#  • server и llm-runner НЕ компилируются в JS — запускаются через tsx прямо из
#    исходников и резолвят @voicechat/* через workspace-симлинки.
#  • better-sqlite3 — нативный модуль → в build-стадии нужен toolchain.
#  • оба web-приложения собираются для того же origin/порта, что и API.

# ---- Стадия сборки -------------------------------------------------------
FROM node:22-bookworm AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm ci
RUN npm run -w @voicechat/web build
RUN npm run -w @voicechat/web-recorder build

# ---- Сборка whisper.cpp: whisper-cli для серверного распознавания речи ----
FROM debian:bookworm-slim AS whisper
RUN apt-get update \
  && apt-get install -y --no-install-recommends git cmake make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.7.5 https://github.com/ggml-org/whisper.cpp /whisper
RUN cmake -S /whisper -B /whisper/build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=OFF \
  && cmake --build /whisper/build -j"$(nproc)" --target whisper-cli

# ---- Общая runtime-база --------------------------------------------------
FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HOME=/home/node \
    VC_DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ---- Runtime сервера -----------------------------------------------------
FROM runtime-base AS server-runtime
ENV PORT=8787 \
    VC_WEB_DIR=/app/apps/web/dist \
    VC_WEB_RECORDER_DIR=/app/apps/web-recorder/dist

RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/index.ts"]

# ---- Изолированный runtime распознавания речи ---------------------------
FROM runtime-base AS stt-runner-runtime
ENV PORT=8791 \
    VC_WHISPER_CLI=/usr/local/bin/whisper-cli \
    VC_MODELS_DIR=/models \
    VC_STT_TEMP_DIR=/stt-tmp
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
RUN mkdir -p /models /stt-tmp && chown -R node:node /models /stt-tmp
VOLUME ["/models", "/stt-tmp"]
EXPOSE 8791
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/stt-runner && exec node --import tsx src/index.ts"]

# ---- Статический Storybook для feature-preview --------------------------
# Отдельная ветка build-графа: production target не выполняет эту сборку.
FROM build AS storybook-build
RUN npm run build:storybook

FROM nginx:1.27-alpine AS storybook-runtime
COPY --from=storybook-build /app/packages/ui/storybook-static /usr/share/nginx/html
EXPOSE 80

# ---- Runtime исполнителя LLM --------------------------------------------
FROM runtime-base AS llm-runner-runtime
ARG INSTALL_CLAUDE_CLI=1
ARG INSTALL_CODEX_CLI=1
ENV PORT=8790

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap \
  && rm -rf /var/lib/apt/lists/*
RUN if [ "$INSTALL_CLAUDE_CLI" = "1" ]; then npm i -g @anthropic-ai/claude-code; fi \
  && if [ "$INSTALL_CODEX_CLI" = "1" ]; then npm i -g @openai/codex; fi

RUN mkdir -p /data /home/node/.claude /home/node/.codex /mnt/server-data \
  && chown -R node:node /data /home/node/.claude /home/node/.codex /mnt/server-data
VOLUME ["/data"]
EXPOSE 8790
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/llm-runner && exec node --import tsx src/index.ts"]

# ---- Piper и голос по умолчанию для TTS ----------------------------------
# Бинарный релиз Piper (со встроенным espeak-ng) по архитектуре и один русский
# голос-«семя»: том /data/voices у нового контейнера пуст, а скачивание голосов из
# UI убрано — без этого озвучка в Docker отвечала бы «No TTS engine available».
FROM debian:bookworm-slim AS piper-assets
ARG TARGETARCH
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_VOICE_PATH=ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar \
  && rm -rf /var/lib/apt/lists/*
RUN set -eux; case "$TARGETARCH" in amd64) arch=x86_64 ;; arm64) arch=aarch64 ;; *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; esac; \
  curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${arch}.tar.gz" -o /tmp/piper.tar.gz; \
  mkdir -p /opt && tar -xzf /tmp/piper.tar.gz -C /opt && rm /tmp/piper.tar.gz; \
  test -x /opt/piper/piper; \
  mkdir -p /opt/piper-voices-seed; \
  base="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/${PIPER_VOICE_PATH}"; \
  curl -fsSL "${base}.onnx" -o "/opt/piper-voices-seed/$(basename "$PIPER_VOICE_PATH").onnx"; \
  curl -fsSL "${base}.onnx.json" -o "/opt/piper-voices-seed/$(basename "$PIPER_VOICE_PATH").onnx.json"

# ---- Runtime исполнителя TTS --------------------------------------------
FROM runtime-base AS tts-runner-runtime
ENV PORT=8791 \
    VC_TTS_DATA_DIR=/data \
    VC_TTS_TEMP_DIR=/tmp/voicechat-tts \
    VC_PIPER_VOICES_DIR=/data/voices \
    VC_PIPER_BIN=/opt/piper/piper \
    VC_PIPER_SEED_VOICES_DIR=/opt/piper-voices-seed
COPY --from=piper-assets /opt/piper /opt/piper
COPY --from=piper-assets /opt/piper-voices-seed /opt/piper-voices-seed
RUN mkdir -p /data/voices /tmp/voicechat-tts \
  && chown -R node:node /data /tmp/voicechat-tts \
  && /opt/piper/piper --help >/dev/null 2>&1 || true
VOLUME ["/data"]
EXPOSE 8791
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/tts-runner && exec node --import tsx src/index.ts"]

# ---- Runtime durable Automation Runner -----------------------------------
# ---- Runtime браузерного раннера (Playwright Reader, этап автотестов) -----
# Отдельная база, а не runtime-base: Chromium тянет десятки системных библиотек,
# и ставить их в общий образ ради одного сервиса значит раздуть все остальные.
# Официальный образ Playwright уже содержит браузеры и зависимости. Тег обязан
# **точно** совпадать с версией пакета `playwright` в apps/browser-runner:
# образ приносит сборку браузера под свою версию, а несовпадающий пакет ищет
# другую (`chromium_headless_shell-1234` против `-1181`) и падает при первом
# запуске сессии. Поэтому там точная версия без `^`, а совпадение держит тест
# apps/browser-runner/src/imageVersion.test.ts.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS browser-runner-runtime
WORKDIR /app
# Пользователь берётся готовый — `pwuser` из образа Playwright (uid 1001).
# Своего заводить нельзя: образ основан на Ubuntu 24.04, где uid 1000 занят
# штатным `ubuntu`, и `useradd -u 1000` валит сборку («UID 1000 is not unique»).
# Общий docker-entrypoint.sh здесь тоже не годится: он сбрасывает привилегии
# через `gosu`, которого в этом образе нет, и мигрирует профили CLI, которых у
# браузерного раннера не бывает.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HOME=/home/pwuser \
    PORT=8792 \
    VC_BROWSER_DATA_DIR=/data
COPY --from=build /app /app
# chown до объявления VOLUME: именованный том при первом создании наследует
# владельца каталога из образа, поэтому процессу под pwuser он доступен на запись.
RUN mkdir -p /data && chown -R pwuser:pwuser /data
VOLUME ["/data"]
EXPOSE 8792
USER pwuser
CMD ["sh", "-c", "cd apps/browser-runner && exec node --import tsx src/index.ts"]

FROM runtime-base AS automation-runner-runtime
ENV PORT=8800 VC_AUTOMATION_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8800
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/automation-runner && exec node --import tsx src/index.ts"]
