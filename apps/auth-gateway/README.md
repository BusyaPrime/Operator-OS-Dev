# @operator-os/auth-gateway

Centralised authentication and device authorisation service for
Operator-OS. Per SPEC § 18-19 and BOOK III.

## Scope (PR A, scaffold)

Currently a minimal Fastify service with `/health` and `/ready`.
Signin, refresh, and signout endpoints land in follow-up PRs:

- **PR B** — `/v1/auth/signin` (Google ID token -> access token + refresh token).
- **PR C** — `/v1/auth/refresh`, `/v1/auth/signout`.
- **PR D** — `operator-api` verifier for the issued access token.
- **PR E** — IAM + Secret Manager + Cloud Run deploy.

## Local dev

```bash
pnpm --filter @operator-os/auth-gateway dev
```

Reads env from `.env` next to this README (if present) plus
`process.env`.

## Env vars

See `.env.example`.

## Ports

Local default `8081` to avoid conflict with `operator-api` on `8080`.

## Architecture notes

- JWT signing: HS256 for MVP, shared secret loaded from Secret
  Manager (`operator-jwt-secret`). Upgrade path to RS256 + JWKS is
  tracked as future work.
- Refresh tokens: SHA-256 hashed at rest in Firestore
  `refreshTokens/{hash}` so plaintext is never stored.
- Rotation on use: every `/v1/auth/refresh` issues a new refresh
  token and invalidates the old one.
- Access token TTL: 1 hour. Refresh token TTL: 30 days.
