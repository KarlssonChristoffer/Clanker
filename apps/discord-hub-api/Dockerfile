# Bygg från repots rot: docker build -f apps/discord-hub-api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo

# Package files first so `npm ci` stays cached until dependencies change (same set as the bot image).
COPY package.json package-lock.json ./
COPY bots/discord-bot/package.json ./bots/discord-bot/
COPY bots/discord-bot/scripts ./bots/discord-bot/scripts
COPY apps/discord-hub-api/package.json ./apps/discord-hub-api/
COPY apps/discord-hub-web/package.json ./apps/discord-hub-web/
COPY apps/dev-tools-web/package.json ./apps/dev-tools-web/
COPY packages/hub-pg-migrate/package.json ./packages/hub-pg-migrate/
COPY packages/ui/package.json ./packages/ui/
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1 \
    YOUTUBE_DL_SKIP_DOWNLOAD=1
RUN npm ci

COPY packages/hub-pg-migrate ./packages/hub-pg-migrate
COPY apps/discord-hub-api ./apps/discord-hub-api
RUN npm run build -w discord-hub-api

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini
# Keep the monorepo layout: dist/../migrations and the hub-pg-migrate workspace symlink must resolve.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/hub-pg-migrate ./packages/hub-pg-migrate
COPY --from=build /repo/apps/discord-hub-api/package.json ./apps/discord-hub-api/package.json
COPY --from=build /repo/apps/discord-hub-api/migrations ./apps/discord-hub-api/migrations
COPY --from=build /repo/apps/discord-hub-api/dist ./apps/discord-hub-api/dist

ENV NODE_ENV=production \
    PORT=3001 \
    DISCORD_HUB_API_LISTEN_HOST=0.0.0.0
EXPOSE 3001 3002
USER node
WORKDIR /app/apps/discord-hub-api
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
