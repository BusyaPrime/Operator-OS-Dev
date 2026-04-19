# Handoff

## Summary

The repository is moving from raw bootstrap into real application scaffolding. The trust model, GCP resource assumptions, and deployment direction are now documented so code work can stay aligned with the product definition.

## Current State

- monorepo foundation exists
- docs are now the source of truth for bootstrap assumptions
- the next major work areas are API, shared packages, mobile, desktop runtime, and CI/deploy prep

## Recommended Reading Order

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SECURITY_MODEL.md`
4. `docs/GCP_RESOURCES.md`
5. `docs/VERTEX.md`
6. `docs/BOOTSTRAP_STATUS.md`

## Next Steps

- finish the shared contracts and config packages
- implement the Fastify API scaffold and Vertex provider abstraction
- build the Expo mobile shell
- build the transparent desktop runtime scaffold
- add CI, Cloud Build, and Cloud Run scripts

## Known Blockers

- local Vertex calls require ADC if tested outside Cloud Run
- mobile native builds are not validated yet during bootstrap
- local Docker image verification requires a running Docker daemon; the current workstation returned a Docker Desktop engine error

## Handoff Rule

Any next agent should preserve the visible trusted-control model and avoid introducing stealth behavior, hidden session control, or secret material in the repository.
