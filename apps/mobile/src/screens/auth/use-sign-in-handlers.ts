import { useCallback, useState } from 'react';

import { GoogleSignInError, googleSignIn as defaultGoogleSignIn } from '../../auth/google-signin';
import type { GoogleSignInModule } from '../../auth/google-signin';
import { useAuthStore } from '../../state/auth-store';

import { signInErrorFor, type SignInErrorMessage } from './sign-in-copy';

/**
 * Deps for the pure orchestrator. All collaborators are injected
 * so tests can drive the function without a React renderer, the
 * native SDK, or a real zustand store.
 */
export interface PerformSignInDeps {
  readonly googleSignIn: Pick<GoogleSignInModule, 'signIn'>;
  readonly signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  readonly setLocalError: (err: SignInErrorMessage | undefined) => void;
  readonly onBeforeStart?: () => void;
  readonly onCancel?: () => void;
}

/**
 * Run the sign-in coordination: open the Google picker, hand
 * the returned idToken to the auth-store, translate any failure
 * into a SignInErrorMessage for the UI.
 *
 * Never throws — every failure flows through `setLocalError`.
 * A user-cancelled Google picker is a silent no-op (optionally
 * observed via `onCancel`).
 */
export const performSignIn = async (deps: PerformSignInDeps): Promise<void> => {
  deps.onBeforeStart?.();
  deps.setLocalError(undefined);

  let idToken: string;
  try {
    const result = await deps.googleSignIn.signIn();
    idToken = result.idToken;
  } catch (err) {
    if (err instanceof GoogleSignInError) {
      if (err.code === 'cancelled') {
        deps.onCancel?.();
        return;
      }
      deps.setLocalError(signInErrorFor(err.code));
      return;
    }
    deps.setLocalError(signInErrorFor('unknown'));
    return;
  }

  try {
    await deps.signInWithGoogleIdToken(idToken);
  } catch (err) {
    // signInWithGoogleIdToken is expected to catch its own
    // errors and store them into the auth-store; if something
    // slipped through, surface it as 'unknown' so the UI still
    // shows the banner instead of silently swallowing.
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown';
    deps.setLocalError(signInErrorFor(code));
  }
};

export interface UseSignInHandlersOptions {
  /** Inject a googleSignIn wrapper (tests). Default: singleton. */
  readonly googleSignIn?: GoogleSignInModule;
}

export interface UseSignInHandlersResult {
  readonly onPressSignIn: () => Promise<void>;
  readonly combinedError: SignInErrorMessage | undefined;
  readonly isBusy: boolean;
}

/**
 * React hook that binds `performSignIn` to the auth-store + a
 * local error slot. Returns:
 *   onPressSignIn  — handler for the CTA
 *   combinedError  — local OR store error (local wins)
 *   isBusy         — true while status=='authenticating'
 *
 * The hook itself is a thin adapter. The interesting branches
 * (happy, cancel, play-services-unavailable, store propagation,
 * generic unknown) live in `performSignIn` and are tested there.
 */
export const useSignInHandlers = (
  options: UseSignInHandlersOptions = {}
): UseSignInHandlersResult => {
  const status = useAuthStore((s) => s.status);
  const storeError = useAuthStore((s) => s.error);
  const signInWithGoogleIdToken = useAuthStore(
    (s) => s.signInWithGoogleIdToken
  );
  const clearError = useAuthStore((s) => s.clearError);
  const [localError, setLocalError] = useState<SignInErrorMessage | undefined>();

  const onPressSignIn = useCallback(async () => {
    await performSignIn({
      googleSignIn: options.googleSignIn ?? defaultGoogleSignIn,
      signInWithGoogleIdToken,
      setLocalError,
      onBeforeStart: () => {
        if (storeError !== undefined) clearError();
      }
    });
  }, [
    clearError,
    options.googleSignIn,
    signInWithGoogleIdToken,
    storeError
  ]);

  return {
    onPressSignIn,
    combinedError: localError ?? storeError,
    isBusy: status === 'authenticating'
  };
};
