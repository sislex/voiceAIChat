# Многостадийные образы voiceAIChat:
#  • server-runtime — Fastify-сервер + web-билды ChatAI и Web Recorder
#  • llm-runner-runtime — внутренний исполнитель claude/codex CLI (apps/llm-runner)
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
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ---- Runtime сервера -----------------------------------------------------
FROM runtime-base AS server-runtime
ENV PORT=8787 \
    VC_WEB_DIR=/app/apps/web/dist \
    VC_WEB_RECORDER_DIR=/app/apps/web-recorder/dist \
    VC_WHISPER_CLI=/usr/local/bin/whisper-cli

RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/index.ts"]

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

# ---- Runtime исполнителя TTS --------------------------------------------
FROM runtime-base AS tts-runner-runtime
ENV PORT=8791 \
    VC_TTS_DATA_DIR=/data \
    VC_TTS_TEMP_DIR=/tmp/voicechat-tts \
    VC_PIPER_VOICES_DIR=/data/voices
RUN mkdir -p /data/voices /tmp/voicechat-tts \
  && chown -R node:node /data /tmp/voicechat-tts
VOLUME ["/data"]
EXPOSE 8791
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/tts-runner && exec node --import tsx src/index.ts"]
