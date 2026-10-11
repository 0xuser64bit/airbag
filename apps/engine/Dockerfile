# The Airbag engine. Build from the repo root:
#   docker build -f apps/engine/Dockerfile -t airbag-engine .
#
# Node 24 runs the TypeScript sources directly, but it refuses to strip types from
# files under node_modules. So the image keeps the workspace layout: @airbag/risk and
# @airbag/perpl stay in packages/ and node_modules only links to them.

FROM node:24.21.0-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/engine/package.json apps/engine/
COPY apps/web/package.json apps/web/
COPY packages/risk/package.json packages/risk/
COPY packages/perpl/package.json packages/perpl/
COPY indexer/package.json indexer/
COPY tools/package.json tools/
RUN pnpm install --frozen-lockfile --prod --filter @airbag/engine...
COPY packages/risk/src packages/risk/src
COPY packages/perpl/src packages/perpl/src
COPY apps/engine/src apps/engine/src

FROM node:24.21.0-slim
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
WORKDIR /app/apps/engine
# SQLite lives on a volume mounted here (DATABASE_PATH=/data/airbag.db).
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/main.ts"]
