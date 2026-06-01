# Stage 1: build Vue task-pane assets
FROM node:22.21.1-alpine3.22 AS build-stage
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn config set network-timeout 300000
RUN apk add --no-cache g++ make py3-pip
RUN yarn global add node-gyp
RUN yarn install
COPY . .
RUN yarn run build

# Stage 2: nginx (static UI) + Node proxy in one container
FROM node:22-alpine

RUN apk add --no-cache nginx tini su-exec \
  && mkdir -p /app/data/logs /app/proxy /run/nginx \
  && addgroup -S nodejs \
  && adduser -S nodejs -G nodejs \
  && chown -R nodejs:nodejs /app/data/logs /app/proxy

COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY proxy-server/server.js /app/proxy/server.js
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && chown nodejs:nodejs /app/proxy/server.js

ENV PORT=3100
ENV LOG_DIR=/app/data/logs
ENV NODE_ENV=production

EXPOSE 80 3100

VOLUME ["/app/data/logs"]

ENTRYPOINT ["/sbin/tini", "-s", "--"]
CMD ["/entrypoint.sh"]
