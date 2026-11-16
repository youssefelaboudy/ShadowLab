FROM node:24-alpine
WORKDIR /app
COPY apps apps
COPY packages packages
COPY package.json .
USER node
ENV HOST=0.0.0.0 PORT=4101
CMD ["node","apps/demo-api/server.ts"]
