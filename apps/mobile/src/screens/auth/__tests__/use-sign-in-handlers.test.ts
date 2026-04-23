import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level mocks so performSignIn's transitive imports
// (google-signin → native module, auth-store → expo-secure-store)
// resolve to stubs in the vitest/Node environment.
vi.mock('@react-native-google-signin/google-signin', () => ({
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER'
  },
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn()
  },
  isErrorWithCode: (err: unknown): err is { code: string; message: string } =>
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined)
}));

import { GoogleSignInError } from '../../../auth/google-signin';
import { errorCopy, signInErrorFor } from '../sign-in-copy';
import {
  performSignIn,
  type PerformSignInDeps
} from '../use-sign-in-handlers';

describe('errorCopy', () => {
  it('returns specific copy for every known auth/google code', () => {
    const codes = [
      'in-progress',
      'play-services-unavailable',
      'not-configured',
      'no-id-token',
      'network',
      'timeout',
      'invalid-credentials',
      'bad-request',
      'server',
      'malformed-response'
    ];
    for (const code of codes) {
      expect(errorCopy(code)).not.toMatch(/Something went wrong/);
    }
  });

  it('falls through to generic copy for unknown codes', () => {
    expect(errorCopy('unknown')).toMatch(/Something went wrong/);
    expect(errorCopy('made-up-code')).toMatch(/Something went wrong/);
  });
});

describe('signInErrorFor', () => {
  it('packs a code + its user-facing message', () => {
    const msg = signInErrorFor('network');
    expect(msg.code).toBe('network');
    expect(msg.message).toMatch(/authentication server/i);
  });
});

describe('performSignIn', () => {
  interface Harness {
    deps: PerformSignInDeps;
    googleSignIn: { signIn: ReturnType<typeof vi.fn> };
    signInWithGoogleIdToken: ReturnType<typeof vi.fn>;
    setLocalError: ReturnType<typeof vi.fn>;
    onBeforeStart: ReturnType<typeof vi.fn>;
    onCancel: ReturnType<typeof vi.fn>;
  }

  const buildHarness = (): Harness => {
    const googleSignIn = { signIn: vi.fn() };
    const signInWithGoogleIdToken = vi.fn().mockResolvedValue(undefined);
    const setLocalError = vi.fn();
    const onBeforeStart = vi.fn();
    const onCancel = vi.fn();
    return {
      deps: {
        googleSignIn,
        signInWithGoogleIdToken,
        setLocalError,
        onBeforeStart,
        onCancel
      },
      googleSignIn,
      signInWithGoogleIdToken,
      setLocalError,
      onBeforeStart,
      onCancel
    };
  };

  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  it('happy path — opens picker, hands idToken to the store, clears error', async () => {
    h.googleSignIn.signIn.mockResolvedValueOnce({ idToken: 'id-1' });

    await performSignIn(h.deps);

    expect(h.onBeforeStart).toHaveBeenCalledOnce();
    expect(h.setLocalError).toHaveBeenCalledWith(undefined); // cleared first
    expect(h.signInWithGoogleIdToken).toHaveBeenCalledWith('id-1');
    // No follow-up setLocalError call — the store handles its own errors.
    expect(h.setLocalError).toHaveBeenCalledTimes(1);
  });

  it('user cancelled Google picker → noop, fires onCancel, NO auth-store call', async () => {
    h.googleSignIn.signIn.mockRejectedValueOnce(
      new GoogleSignInError('cancelled', 'user dismissed')
    );

    await performSignIn(h.deps);

    expect(h.onCancel).toHaveBeenCalledOnce();
    expect(h.signInWithGoogleIdToken).not.toHaveBeenCalled();
    // setLocalError only called once — the initial "clear" — no
    // error payload follows a cancel.
    expect(h.setLocalError).toHaveBeenCalledTimes(1);
    expect(h.setLocalError).toHaveBeenCalledWith(undefined);
  });

  it('play-services-unavailable → sets friendly local error', async () => {
    h.googleSignIn.signIn.mockRejectedValueOnce(
      new GoogleSignInError('play-services-unavailable', 'missing')
    );

    await performSignIn(h.deps);

    const calls = h.setLocalError.mock.calls;
    const finalCall = calls[calls.length - 1][0];
    expect(finalCall).toEqual({
      code: 'play-services-unavailable',
      message: expect.stringMatching(/Play Services/i)
    });
    expect(h.signInWithGoogleIdToken).not.toHaveBeenCalled();
  });

  it('any other GoogleSignInError code → friendly local error', async () => {
    h.googleSignIn.signIn.mockRejectedValueOnce(
      new GoogleSignInError('no-id-token', 'no token returned')
    );

    await performSignIn(h.deps);

    const finalCall =
      h.setLocalError.mock.calls[h.setLocalError.mock.calls.length - 1][0];
    expect(finalCall.code).toBe('no-id-token');
    expect(finalCall.message).toMatch(/Please try again/i);
  });

  it('non-GoogleSignInError thrown by picker → generic unknown copy', async () => {
    h.googleSignIn.signIn.mockRejectedValueOnce(new Error('native panic'));

    await performSignIn(h.deps);

    const finalCall =
      h.setLocalError.mock.calls[h.setLocalError.mock.calls.length - 1][0];
    expect(finalCall.code).toBe('unknown');
    expect(finalCall.message).toMatch(/Something went wrong/i);
    expect(h.signInWithGoogleIdToken).not.toHaveBeenCalled();
  });

  it('signInWithGoogleIdToken rejection → surfaces the thrown code', async () => {
    h.googleSignIn.signIn.mockResolvedValueOnce({ idToken: 'id-1' });
    h.signInWithGoogleIdToken.mockRejectedValueOnce({
      code: 'server',
      message: 'upstream'
    });

    await performSignIn(h.deps);

    const finalCall =
      h.setLocalError.mock.calls[h.setLocalError.mock.calls.length - 1][0];
    expect(finalCall.code).toBe('server');
    expect(finalCall.message).toMatch(/temporarily unavailable/i);
  });

  it('signInWithGoogleIdToken rejection without code → unknown copy', async () => {
    h.googleSignIn.signIn.mockResolvedValueOnce({ idToken: 'id-1' });
    h.signInWithGoogleIdToken.mockRejectedValueOnce(new Error('random'));

    await performSignIn(h.deps);

    const finalCall =
      h.setLocalError.mock.calls[h.setLocalError.mock.calls.length - 1][0];
    expect(finalCall.code).toBe('unknown');
  });

  it('clears previous error before each attempt', async () => {
    h.googleSignIn.signIn.mockResolvedValueOnce({ idToken: 'id-1' });
    await performSignIn(h.deps);
    // First call to setLocalError is always the "clear" with undefined.
    expect(h.setLocalError.mock.calls[0][0]).toBeUndefined();
    expect(h.onBeforeStart).toHaveBeenCalledBefore(
      h.signInWithGoogleIdToken as unknown as ReturnType<typeof vi.fn>
    );
  });
});
