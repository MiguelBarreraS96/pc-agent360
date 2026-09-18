# Build Angular and serve the production bundle with Nginx on Cloud Run.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -- --configuration=production

FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod 0555 /docker-entrypoint.sh && rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist/frontend/browser/ /usr/share/nginx/html/

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
