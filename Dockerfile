# Warqa studio + CLI. Build: docker build -t warqa .   Run: docker compose up
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Runtime: Playwright's image has Node and the browsers used by QA and video export.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3-pip zip \
 && pip install --break-system-packages --no-cache-dir edge-tts \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production WARQA_HOME=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app /app
RUN ln -s /app/apps/cli/dist/warqa.js /usr/local/bin/warqa && chmod +x /app/apps/cli/dist/warqa.js
VOLUME ["/books", "/data"]
EXPOSE 5170
# Keys: pass them with an env file (docker compose reads .env) or enter them in the studio settings.
CMD ["node", "apps/studio/dist/server/index.js", "--root", "/books", "--port", "5170", "--host", "0.0.0.0"]
