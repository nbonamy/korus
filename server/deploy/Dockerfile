FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
WORKDIR /opt/telemetry
COPY collector.mjs container.mjs ./
USER 10001:10001
ENTRYPOINT ["node", "/opt/telemetry/container.mjs"]
