# Bygg från repots rot: docker build -f bots/discord-bot/Dockerfile .
# @discordjs/voice ≥0.19 requires Node ≥22.12.0 (DAVE / e2ee). node:22-alpine tracks the latest 22.x.
FROM node:22-alpine AS build
WORKDIR /repo

# Kopiera bara package-filer först — npm ci cachas så länge de inte ändras.
COPY package.json package-lock.json ./
COPY bots/discord-bot/package.json ./bots/discord-bot/
# postinstall kör patch-prism-ffmpeg-env.mjs — måste finnas före npm ci.
COPY bots/discord-bot/scripts ./bots/discord-bot/scripts
COPY apps/discord-hub-api/package.json ./apps/discord-hub-api/
COPY apps/discord-hub-web/package.json ./apps/discord-hub-web/
COPY apps/dev-tools-web/package.json ./apps/dev-tools-web/
COPY packages/hub-pg-migrate/package.json ./packages/hub-pg-migrate/
COPY packages/ui/package.json ./packages/ui/
# youtube-dl-exec: skip its python check and binary download — the runtime stage installs yt-dlp itself.
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1 \
    YOUTUBE_DL_SKIP_DOWNLOAD=1
RUN npm ci

# Kopiera källkod och bygg (hub-pg-migrate krävs av discord-bot).
COPY packages/hub-pg-migrate ./packages/hub-pg-migrate
COPY bots/discord-bot ./bots/discord-bot
COPY apps/discord-hub-api/migrations ./apps/discord-hub-api/migrations
RUN npm run build --prefix packages/hub-pg-migrate && npm run build -w discord-bot

FROM node:22-alpine
WORKDIR /app

# yt-dlp: the platform-independent release is a Python zipapp, so the runtime needs python3.
# YouTube challenges need a JS runtime; node is already here and is enabled via YTDLP_EXTRA_ARGS.
# tini reaps yt-dlp/ffmpeg children and forwards SIGTERM/SIGINT to node.
RUN apk add --no-cache python3 ca-certificates tini

# Bump YTDLP_CACHEBUST (e.g. --build-arg YTDLP_CACHEBUST=$(date +%s)) to force a fresh download on rebuild.
ARG YTDLP_VERSION=latest
ARG YTDLP_CACHEBUST=0
RUN set -eux; \
    echo "yt-dlp cachebust: ${YTDLP_CACHEBUST}"; \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
      url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
    else \
      url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"; \
    fi; \
    mkdir -p /opt/yt-dlp; \
    wget -qO /opt/yt-dlp/yt-dlp "$url"; \
    chmod 0755 /opt/yt-dlp/yt-dlp; \
    chown -R node:node /opt/yt-dlp; \
    /opt/yt-dlp/yt-dlp --version

# Symlink @clanker/hub-pg-migrate → ../../packages/hub-pg-migrate kräver att packages/ finns i imagen.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/hub-pg-migrate ./packages/hub-pg-migrate
COPY --from=build /repo/apps/discord-hub-api/migrations ./migrations
COPY --from=build /repo/bots/discord-bot/dist ./dist
COPY --from=build /repo/bots/discord-bot/package.json ./package.json

ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/yt-dlp \
    YTDLP_EXTRA_ARGS="--js-runtimes node" \
    YTDLP_AUTO_UPDATE=1

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
