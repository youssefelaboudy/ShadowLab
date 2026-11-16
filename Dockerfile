FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
ARG SHADOWLAB_COMMIT
ENV SHADOWLAB_COMMIT=$SHADOWLAB_COMMIT
COPY config config
COPY fixtures fixtures
COPY docs/history docs/history
COPY scenarios scenarios
COPY apps apps
COPY tools tools
COPY packages packages
COPY package.json .
USER node
ENV HOST=127.0.0.1 PORT=4101
CMD ["node","apps/demo-api/server.ts"]

