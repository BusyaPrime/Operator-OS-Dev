# Operator OS Mobile

Expo + React Native scaffold for the phone-first operator surface.

## Included In Bootstrap

- bottom-tab navigation
- Home, Devices, Sessions, Costs, and Settings screens
- theme tokens and shared screen shell
- mocks and Zustand state skeleton
- API client skeleton that can switch from mocks to live `/health`

## Local Run

```powershell
pnpm --filter @operator-os/mobile dev
```

## Build Scope

The bootstrap `build` script validates TypeScript and emits a scaffold manifest. It is not yet a signed native app build pipeline.
