ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends iptables && rm -rf /var/lib/apt/lists/*
# No source, credentials or production configuration is included in this guard image.
ENTRYPOINT ["/bin/sh"]
