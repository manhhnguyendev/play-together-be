# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    PGLITE_DIR=/app/.data/pgdata \
    UPLOAD_DIR=/app/uploads
WORKDIR /app

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

# Both directories are made here, while still root, because the process drops to `node` below and
# `/app` itself belongs to root: `POST /uploads` resolves UPLOAD_DIR against the working directory and
# the boot mkdir would then die with EACCES on /app/uploads.
RUN mkdir -p /app/.data /app/uploads && chown -R node:node /app/.data /app/uploads

USER node
EXPOSE 3000
VOLUME ["/app/.data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/'+(process.env.API_PREFIX||'api/v2')+'/health',agent:false,timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
