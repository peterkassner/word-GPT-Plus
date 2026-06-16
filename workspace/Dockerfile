# Stage 1: build Vue task-pane assets
FROM node:22.21.1-alpine3.22 AS build-stage
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn config set network-timeout 300000
RUN apk add --no-cache g++ make py3-pip
RUN yarn global add node-gyp
RUN yarn install
COPY . .
# Vite only — prebuild manifest bump needs repo references/ (not in image context)
RUN ./node_modules/.bin/vite build

# Stage 2: nginx (static UI on 80) + Node proxy (3100) — single supervised process tree
FROM node:22-alpine

RUN apk add --no-cache nginx tini su-exec curl netcat-openbsd \
  && mkdir -p /app/data/logs /app/proxy /run/nginx /var/log/nginx \
  && addgroup -S nodejs \
  && adduser -S nodejs -G nodejs \
  && chown -R nodejs:nodejs /app/data/logs /app/proxy

COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY proxy-server/server.js /app/proxy/server.js
COPY docker/nginx-default.conf /etc/nginx/http.d/word-gpt-plus.conf
RUN rm -f /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/healthcheck.sh /healthcheck.sh
RUN chmod +x /entrypoint.sh /healthcheck.sh \
  && chown nodejs:nodejs /app/proxy/server.js

ENV PORT=3100
ENV LOG_DIR=/app/data/logs
ENV NODE_ENV=production

EXPOSE 80 3100

VOLUME ["/app/data/logs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/healthcheck.sh"]

# tini reaps zombies; entrypoint supervises nginx + proxy as one unit
ENTRYPOINT ["/sbin/tini", "-s", "--"]
CMD ["/entrypoint.sh"]
