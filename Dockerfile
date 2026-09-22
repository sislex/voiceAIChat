# Core runtime and applications that still belong to this repository.
# Extracted services are built and gated by their owner repositories.
FROM node:22-bookworm AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .
# Electron is only a host integration test dependency; its binary is not used by Core services.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
ARG VC_APPLICATION_COMMIT
RUN VC_APPLICATION_COMMIT="$VC_APPLICATION_COMMIT" npm run build:frontends
RUN npm run verify:core-ui

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

FROM runtime-base AS server-runtime
ARG VC_APPLICATION_METADATA=null
ARG VC_APPLICATION_VERSION
ARG VC_APPLICATION_API_VERSION
ARG VC_APPLICATION_DATA_VERSION
ARG VC_APPLICATION_COMMIT
LABEL com.voicechat.release=$VC_APPLICATION_METADATA
ENV VC_APPLICATION_ID=core \
    VC_APPLICATION_VERSION=$VC_APPLICATION_VERSION \
    VC_APPLICATION_API_VERSION=$VC_APPLICATION_API_VERSION \
    VC_APPLICATION_DATA_VERSION=$VC_APPLICATION_DATA_VERSION \
    VC_APPLICATION_COMMIT=$VC_APPLICATION_COMMIT
ENV PORT=8787 \
    VC_WEB_DIR=/app/node_modules/@sislexa/core-ui/web

RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/index.ts"]

FROM runtime-base AS kanban-runtime
ENV PORT=8789
RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8789
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/kanban/standalone/index.ts"]

FROM runtime-base AS machines-runtime
ENV PORT=8793
RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8793
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/machines/standalone/index.ts"]

FROM runtime-base AS admin-runtime
ENV PORT=8794
RUN mkdir -p /data \
  && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8794
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/server && exec node --import tsx src/admin/standalone/index.ts"]

FROM build AS storybook-build
RUN npm run verify:core-ui

FROM nginx:1.27-alpine AS storybook-runtime
COPY --from=storybook-build /app/node_modules/@sislexa/core-ui/storybook /usr/share/nginx/html
EXPOSE 80

FROM runtime-base AS automation-runner-runtime
ENV PORT=8800 VC_AUTOMATION_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8800
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "cd apps/automation-runner && exec node --import tsx src/index.ts"]
