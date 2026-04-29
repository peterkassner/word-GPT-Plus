FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./

RUN addgroup -S nodejs \
  && adduser -S nodejs -G nodejs \
  && mkdir -p /app/data/logs \
  && chown -R nodejs:nodejs /app

USER nodejs

ENV PORT=3100
ENV LOG_DIR=/app/data/logs

EXPOSE 3100

CMD ["node", "server.js"]
