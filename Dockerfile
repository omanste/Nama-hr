# Nama HR Portal — runs entirely on Nama's own server (Dokploy). Designed by Eng. Hassan Al Riyami.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY public ./public
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data
ENV PORT=3000 DATA_DIR=/data APP_ENV=production
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# runs as the unprivileged "node" user; a new /data volume inherits node ownership from the image
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
