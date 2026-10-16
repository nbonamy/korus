# Supply an operator-reviewed Node image pinned by digest. Build the standalone
# bundle first; the relay image contains no provider runtime or credentials.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/companion-relay
COPY relay.mjs ./relay.mjs
RUN mkdir -p /var/lib/companion-relay && chown -R 10001:10001 /var/lib/companion-relay
USER 10001:10001
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay.mjs", "/run/companion-relay/config.json"]
