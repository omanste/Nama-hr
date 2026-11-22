# Nama HR Portal — runs entirely on Nama's own server (Dokploy). Designed by Eng. Hassan Al Riyami.
FROM node:24-alpine
WORKDIR /app
# pdftotext / pdftoppm: read passports, IDs and visas uploaded as PDF (text layer, else the page as a picture);
# imagemagick: cleaned copies of a card (grey, more contrast) so the Arabic name reads through the security background
RUN apk add --no-cache poppler-utils imagemagick
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY public ./public
COPY server ./server
# what changed (the HR system updates page) and which commit this build is: the changelog and git's HEAD/refs
# (.dockerignore lets only those git files through; .gitignore is always there, so the copy never finds nothing)
COPY CHANGELOG-HR.md ./
COPY .gitignore .gi[t] ./.gitmeta/
RUN mkdir -p /data && chown -R node:node /data
ENV PORT=3000 DATA_DIR=/data APP_ENV=production
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# starts as root only to hand /data to the "node" user (a host folder or old volume may be root-owned), then runs as node
CMD ["sh", "-c", "chown -R node:node /data && exec su node -s /bin/sh -c 'exec node --disable-warning=ExperimentalWarning server/index.mjs'"]
