# Bygg från repots rot: docker build -f apps/discord-hub-web/Dockerfile .
# Hela repot behövs (workspaces: @clanker/ui m.m.).
FROM node:22-alpine AS build
WORKDIR /repo
# .env is not in the build context (.dockerignore), so Vite's build-time variables come in as build args
# (compose passes them from the root .env).
ARG VITE_DISCORD_HUB_GUILD_ID=""
ARG VITE_API_URL=""
ARG VITE_WHEEL_COLLAB_URL=""
ENV VITE_DISCORD_HUB_GUILD_ID=$VITE_DISCORD_HUB_GUILD_ID \
    VITE_API_URL=$VITE_API_URL \
    VITE_WHEEL_COLLAB_URL=$VITE_WHEEL_COLLAB_URL \
    YOUTUBE_DL_SKIP_PYTHON_CHECK=1 \
    YOUTUBE_DL_SKIP_DOWNLOAD=1
COPY . .
RUN npm ci && npm run build -w discord-hub-web

FROM nginx:1.27-alpine
COPY apps/discord-hub-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/discord-hub-web/dist /usr/share/nginx/html
EXPOSE 80
