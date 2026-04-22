# Day 4-5 — auth-gateway Service

## Context

Per SPEC § 18-19 the mobile app and (eventually) desktop-agent sign
in via Google OAuth and receive an access token / refresh token pair
issued by our own auth-gateway. Operator-api then verifies the
access token instead of (or alongside) the Firebase ID token flow.

## Strategy

Split into sub-PRs to keep each change reviewable and deployable:

- **PR A (this session):** auth-gateway workspace scaffold. Fastify
  service, /health and /ready only, Dockerfile, Cloud Build config,
  Cloud Run manifest template, tests. No auth logic yet.

- **PR B:** /v1/auth/signin. Google ID token verification, user
  upsert to Firestore, access token (HS256 JWT) + refresh token
  issuance.

- **PR C:** /v1/auth/refresh + /v1/auth/signout. Refresh token
  rotation + revocation.

- **PR D:** operator-api verifyAccessToken. Accept the new access
  token alongside Firebase ID tokens on /v1/agent/* and /v1/ai/*.

- **PR E:** infra — IAM bindings, Secret Manager entries, first
  deploy. Requires explicit deploy-go per R25 (new Cloud Run
  service, new IAM).

Sub-PRs A-D are code-only and can merge autonomously. PR E needs
the deploy gate.

## Key decisions (noted in docs/DECISIONS.md when implemented)

- **Symmetric HS256** for MVP (single signing secret in Secret
  Manager, shared by auth-gateway and operator-api verifier).
  Rationale: simplest viable, upgrade path to RS256+JWKS tracked as
  future work.
- **Refresh tokens hashed at rest.** SHA-256 of the token is the
  Firestore document id. Plaintext never stored.
- **Access token TTL 1h, refresh TTL 30 days, rotation on use.**
- **Signing secret name:** reuse `operator-jwt-secret` already
  provisioned per docs/IAM_PLAN.md.

