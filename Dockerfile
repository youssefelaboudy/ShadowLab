FROM node:24-alpine
WORKDIR /app
COPY scenarios scenarios
COPY apps apps
COPY packages packages
COPY package.json .
USER node
ENV HOST=127.0.0.1 PORT=4101
CMD ["node","apps/demo-api/server.ts"]

