FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/auth-gateway/package.json apps/auth-gateway/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/auth-gateway apps/auth-gateway
COPY packages/config packages/config
COPY packages/contracts packages/contracts

RUN pnpm --filter @operator-os/contracts build
RUN pnpm --filter @operator-os/config build
RUN pnpm --filter @operator-os/auth-gateway build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/auth-gateway/package.json ./apps/auth-gateway/package.json
COPY --from=build /app/apps/auth-gateway/dist ./apps/auth-gateway/dist
COPY --from=deps /app/apps/auth-gateway/node_modules ./apps/auth-gateway/node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/packages/config/package.json ./packages/config/package.json
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules

EXPOSE 8081
WORKDIR /app/apps/auth-gateway

CMD ["node", "dist/server.js"]
