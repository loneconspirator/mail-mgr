# Build stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json esbuild.mjs ./
COPY src/ src/
COPY config/ config/

RUN npm run build

# Runtime stage
FROM node:22-alpine

RUN addgroup -S mailmgr && adduser -S mailmgr -G mailmgr

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/
COPY config/ config/

# Entrypoint script for first-run config seeding
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chown mailmgr:mailmgr /data

USER mailmgr

EXPOSE 3000

VOLUME /data

ENV DATA_PATH=/data
ENV NODE_ENV=production

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
