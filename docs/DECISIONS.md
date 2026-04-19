# Decisions

## Monorepo With pnpm And Turborepo

Decision:

- use a single monorepo with `pnpm` workspaces and `turborepo`

Why:

- shared contracts and config packages are first-class requirements
- API, mobile, and desktop runtime need coordinated versioning
- bootstrap needs one place for CI and deployment foundations

## TypeScript As The Default Language

Decision:

- use TypeScript across backend, mobile, desktop, and shared packages where practical

Why:

- shared contracts remain type-safe across all runtimes
- bootstrap can move faster with one primary language toolchain

## Fastify For The API

Decision:

- use Fastify, not NestJS or a heavier framework

Why:

- good Cloud Run fit
- small surface area for a control-plane API
- strong TypeScript support

## Expo For Mobile

Decision:

- use Expo + React Native + TypeScript

Why:

- fastest path to a mobile-first operator shell
- clean upgrade path to native capabilities later if needed

## Vertex AI Only

Decision:

- keep runtime AI features on Vertex AI / Gemini only

Why:

- aligns with the GCP-first platform decision
- allows ADC and service-account based auth
- avoids mixed-provider runtime complexity during bootstrap

## Cloud Run First

Decision:

- target Cloud Run for the backend runtime

Why:

- it matches the required hosting model
- it avoids premature GKE complexity
- it fits a stateless Fastify API bootstrap well

## No Hidden Remote Control

Decision:

- enforce an explicit trusted control model

Why:

- it is central to the product definition
- it keeps architecture aligned with user-visible approval flows
- it avoids drifting into spyware-like behavior

## No Prisma/Postgres During Bootstrap

Decision:

- do not add a relational persistence layer yet

Why:

- the project already has Firestore and other managed GCP primitives available
- bootstrap should focus on contracts, orchestration, and deployment shape first
