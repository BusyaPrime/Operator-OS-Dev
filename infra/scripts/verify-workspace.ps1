$ErrorActionPreference = "Stop"

$env:PATH = "D:\Programs\Bin;$env:PATH"

pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker build -f apps/api/Dockerfile -t operator-os-api:local .
