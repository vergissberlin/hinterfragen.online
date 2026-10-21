FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS web-build
COPY . .
ARG PUBLIC_DEMO_MODE=false
ARG PUBLIC_YOUTUBE_CLIENT_ID=
ARG PUBLIC_OPERATOR_NAME=
ARG PUBLIC_OPERATOR_ADDRESS=
ARG PUBLIC_OPERATOR_EMAIL=
ARG LIVE_MODE=false
ENV PUBLIC_DEMO_MODE=$PUBLIC_DEMO_MODE PUBLIC_YOUTUBE_CLIENT_ID=$PUBLIC_YOUTUBE_CLIENT_ID PUBLIC_OPERATOR_NAME=$PUBLIC_OPERATOR_NAME PUBLIC_OPERATOR_ADDRESS=$PUBLIC_OPERATOR_ADDRESS PUBLIC_OPERATOR_EMAIL=$PUBLIC_OPERATOR_EMAIL LIVE_MODE=$LIVE_MODE
RUN npm run build

FROM dependencies AS backend
COPY server ./server
COPY src/lib ./src/lib
COPY config ./config
COPY tsconfig.json tsconfig.server.json ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/data
EXPOSE 3001
CMD ["npm","run","api"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
EXPOSE 8080
