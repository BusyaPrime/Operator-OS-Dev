# Operator OS Mobile

Expo + React Native shell for the phone-first operator surface.
Phase 1.5 adds Google Sign-In + a real session layer on top of
the existing bootstrap-era dashboard scaffold.

## Included

- Bottom-tab navigation (Home / Devices / Sessions / Costs / Settings)
- Root-level native-stack that switches between an auth flow and
  the tab shell based on auth state (Phase 1.5)
- Theme tokens + shared screen shell (ScreenShell, SectionCard,
  StatusPill)
- Zustand stores: `useOperatorStore` for dashboard data, plus
  `useAuthStore` for sign-in / refresh / sign-out (Phase 1.5)
- `services/api-client.ts` — dashboard fetcher with Zod + the
  existing controlled-fallback pattern
- `services/auth-client.ts` — typed wrapper over
  `auth-gateway /v1/auth/{signin,refresh,signout}` (Phase 1.5)
- `services/authenticated-api-client.ts` — fetch wrapper with
  proactive expiry refresh + retry-on-401 (Phase 1.5)
- `auth/google-signin.ts` — domain-narrow wrapper over
  `@react-native-google-signin/google-signin` (Phase 1.5)
- `auth/token-storage.ts` — `expo-secure-store`-backed refresh-
  token persistence (Phase 1.5)

## Local Run

```powershell
pnpm --filter @operator-os/mobile dev
```

Without a configured web client id the Sign-In button renders
disabled with an inline "Google Sign-In is not configured" note;
everything else boots normally.

## Google Sign-In Setup (production preconditions)

> **Akmal must complete these in Google Cloud Console before a
> user-facing build can sign in.** Development smoke-test with
> the existing Web OAuth client id is enough for PR review.

### 1. OAuth 2.0 credentials

In `APIs & Services → Credentials`:

| Client type | Purpose | Required field |
| --- | --- | --- |
| Web application | `aud` claim on idToken; server-side audience | — (already exists) |
| iOS | Native sign-in bundle binding | Bundle identifier matches `app.json` |
| Android | Native sign-in package binding | Package name + SHA-1 fingerprint |

To get the Android SHA-1 for a managed-Expo build:

```bash
# inside the EAS-built project directory
eas credentials
# → choose Android → see "SHA-1 Fingerprint"
```

For dev (Expo Go), Expo ships its own certificate; see
`https://docs.expo.dev/versions/latest/sdk/google-signin/` for
the current fingerprint.

### 2. Environment variables

Set these in `.env` (Expo reads `EXPO_PUBLIC_*` at build time
and exposes them to the runtime):

```
EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL=https://auth-gateway.<env>.run.app
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios-client-id>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<android-client-id>.apps.googleusercontent.com
```

All three Google IDs are optional at schema level; production
builds need the Web + platform-specific one.

### 3. Auth-gateway acceptance

Add the Web OAuth client id to `auth-gateway`'s
`AUTH_ACCEPTED_GOOGLE_CLIENT_IDS` (comma-separated) so the
server trusts the `aud` claim on the idToken the mobile client
sends. The dev web client is already listed; add iOS/Android
client ids there when they exist.

## Auth Flow (at runtime)

```
┌─ app launch ────────────────────────────────────────────────┐
│ <RootNavigator/> sees status='unknown'                       │
│   └─ <AuthLoadingScreen/> mounts                             │
│        └─ useEffect() → authStore.bootstrap()                │
│              ├─ tokenStorage.readRefreshToken()              │
│              ├─ [if present] authClient.refresh(token)       │
│              └─ status → 'authenticated' OR 'unauthenticated'│
└──────────────────────────────────────────────────────────────┘
             │
             ▼
┌─ authenticated=false ────────────────────────────────────────┐
│ <SignInScreen/> mounts                                       │
│   └─ tap "Continue with Google"                              │
│        └─ useSignInHandlers → performSignIn()                │
│              ├─ googleSignIn.signIn() → { idToken }          │
│              └─ authStore.signInWithGoogleIdToken(idToken)   │
│                    ├─ authClient.signin(idToken)             │
│                    ├─ tokenStorage.writeRefreshToken()       │
│                    └─ status → 'authenticated'               │
│                          RootNavigator swaps to <RootTabs/>  │
└──────────────────────────────────────────────────────────────┘
             │
             ▼
┌─ authenticated=true ─────────────────────────────────────────┐
│ <RootTabs/> (existing 5 tabs)                                │
│   api calls via `createAuthenticatedFetch(deps)` which:      │
│     • attaches `Authorization: Bearer <accessToken>`         │
│     • proactively refreshes if <5min to expiry               │
│     • on 401: refresh once + retry; double-401 → forceSignOut│
└──────────────────────────────────────────────────────────────┘
```

## Security posture (Phase 1.5 §3.3)

- Access tokens **never** persist to disk — memory-only in
  `useAuthStore`.
- Refresh tokens live in `expo-secure-store` under namespace
  `operator-os-auth.refreshToken` (iOS Keychain / Android
  Keystore).
- `token-storage.ts` deliberately does **not** log token values
  on any path.
- Every auth-gateway response is Zod-parsed via the schemas
  exported from `@operator-os/contracts` before the store
  trusts it; a schema drift becomes `AuthClientError(code:
  'malformed-response')`, not a silent compromise.

## Testing

```bash
pnpm --filter @operator-os/mobile typecheck
pnpm --filter @operator-os/mobile lint
pnpm --filter @operator-os/mobile test
```

Phase 1.5 landed 73 new tests (75 total) across the auth layer:

| module                         | tests |
| ------------------------------ | ----- |
| `auth/token-storage`           |  9    |
| `services/auth-client`         | 13    |
| `auth/google-signin`           | 14    |
| `state/auth-store`             | 14    |
| `services/authenticated-api-client` | 12 |
| `screens/auth/use-sign-in-handlers` | 11 |
| `state/operator-store` (pre-existing) | 2 |

`SignInScreen.tsx` itself is a thin render shell over
`useSignInHandlers`; behaviour branches (happy, cancelled,
play-services-unavailable, store error, generic failure) are
tested at the orchestrator level in
`use-sign-in-handlers.test.ts`. The rationale — and why we
did not bring `@testing-library/react-native` under vitest —
is recorded in `docs/DECISIONS.md`.

## Known gaps

- End-to-end device test of the native Google Sign-In flow is
  manual (no E2E framework yet; testIDs have been added so
  Detox/Maestro wiring is cheap when we get there).
- Mobile UI for sign-out is not yet wired into the Settings
  tab — the store action exists and is tested; the button
  lands in a follow-up PR.
- Production Google Sign-In requires the Cloud Console setup
  above before a user-facing build can authenticate.

## Build Scope

The bootstrap `build` script validates TypeScript and emits a
scaffold manifest. It is not yet a signed native app build
pipeline — Phase 2 work.
