# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/provider-gmail/package.json packages/provider-gmail/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm build && pnpm --filter fluxmail deploy --legacy --prod /out

FROM node:22-slim
ENV NODE_ENV=production \
    FLUXMAIL_DATA_DIR=/data \
    FLUXMAIL_PORT=8977
WORKDIR /app
COPY --from=build /out ./
RUN chmod +x dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/fluxmail && \
    mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8977
USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
