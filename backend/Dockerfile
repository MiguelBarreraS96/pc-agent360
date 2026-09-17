# syntax=docker/dockerfile:1

# Compila TypeScript en una etapa aislada.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Conserva únicamente dependencias de producción y artefactos compilados.
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
RUN chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
