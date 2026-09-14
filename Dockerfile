# syntax=docker/dockerfile:1
# Version: 2.6.1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

FROM dependencies AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS production-dependencies
WORKDIR /app
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3002

# PostgreSQL is external to this image and is reached through DB_HOST/DB_PORT.
# On each backend start, apply only pending TypeORM migrations, then start the API.
CMD ["sh", "-c", "node dist/database/run-migrations.js && exec node dist/server.js"]
