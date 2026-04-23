import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock the vendor module wholesale so tests can run under Node
 * without the native Google Sign-In module linked. The wrapper
 * injects its own SDK via `createGoogleSignIn({ sdk: asSdk(sdk) })`, but
 * `isErrorWithCode` + `statusCodes` still have to exist at
 * import time.
 */
vi.mock('@react-native-google-signin/google-signin', () => {
  const statusCodes = {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER'
  } as const;
  return {
    statusCodes,
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
  };
});

import {
  createGoogleSignIn,
  GoogleSignInError,
  type RawGoogleSDK
} from '../google-signin.js';

interface FakeSDK {
  configure: ReturnType<typeof vi.fn>;
  hasPlayServices: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

const makeFakeSdk = (): FakeSDK => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn().mockResolvedValue(true),
  signIn: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined)
});

/** vi.fn() is typed too loosely for `RawGoogleSDK`; narrow via unknown. */
const asSdk = (sdk: FakeSDK): RawGoogleSDK => sdk as unknown as RawGoogleSDK;

describe('googleSignIn wrapper', () => {
  let sdk: FakeSDK;

  beforeEach(() => {
    sdk = makeFakeSdk();
  });

  describe('configure() + isConfigured()', () => {
    it('starts un-configured until configure() is called', () => {
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      expect(gs.isConfigured()).toBe(false);
      gs.configure({ webClientId: 'web-id' });
      expect(gs.isConfigured()).toBe(true);
      expect(sdk.configure).toHaveBeenCalledWith({
        webClientId: 'web-id',
        iosClientId: undefined
      });
    });

    it('forwards iosClientId when provided', () => {
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id', iosClientId: 'ios-id' });
      expect(sdk.configure).toHaveBeenCalledWith({
        webClientId: 'web-id',
        iosClientId: 'ios-id'
      });
    });
  });

  describe('signIn()', () => {
    it('throws not-configured when configure() is missing', async () => {
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      await expect(gs.signIn()).rejects.toMatchObject({
        code: 'not-configured'
      });
      expect(sdk.signIn).not.toHaveBeenCalled();
    });

    it('returns idToken + user from the v13+ { data: ... } shape', async () => {
      sdk.signIn.mockResolvedValueOnce({
        data: {
          idToken: 'id-token-value',
          user: { email: 'u@x.com', name: 'Test', photo: 'http://p/i.png' }
        }
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });

      const result = await gs.signIn();
      expect(result.idToken).toBe('id-token-value');
      expect(result.email).toBe('u@x.com');
      expect(result.displayName).toBe('Test');
      expect(result.photoUrl).toBe('http://p/i.png');
    });

    it('accepts the legacy flat response shape (no data wrapper)', async () => {
      sdk.signIn.mockResolvedValueOnce({
        idToken: 'id-token-legacy',
        user: { email: 'legacy@x.com' }
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });

      const result = await gs.signIn();
      expect(result.idToken).toBe('id-token-legacy');
      expect(result.email).toBe('legacy@x.com');
    });

    it('throws no-id-token when the SDK returns an empty idToken', async () => {
      sdk.signIn.mockResolvedValueOnce({ data: { idToken: null } });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await expect(gs.signIn()).rejects.toMatchObject({
        code: 'no-id-token'
      });
    });

    it('maps SIGN_IN_CANCELLED → code=cancelled', async () => {
      sdk.signIn.mockRejectedValueOnce({
        code: 'SIGN_IN_CANCELLED',
        message: 'dismissed'
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await expect(gs.signIn()).rejects.toMatchObject({ code: 'cancelled' });
    });

    it('maps IN_PROGRESS → code=in-progress', async () => {
      sdk.signIn.mockRejectedValueOnce({
        code: 'IN_PROGRESS',
        message: 'already'
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await expect(gs.signIn()).rejects.toMatchObject({
        code: 'in-progress'
      });
    });

    it('maps PLAY_SERVICES_NOT_AVAILABLE → code=play-services-unavailable', async () => {
      sdk.hasPlayServices.mockRejectedValueOnce({
        code: 'PLAY_SERVICES_NOT_AVAILABLE',
        message: 'missing'
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await expect(gs.signIn()).rejects.toMatchObject({
        code: 'play-services-unavailable'
      });
    });

    it('maps any other SDK error → code=unknown', async () => {
      sdk.signIn.mockRejectedValueOnce(new Error('kaboom'));
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await expect(gs.signIn()).rejects.toMatchObject({ code: 'unknown' });
    });

    it('skips Play Services when requirePlayServices=false', async () => {
      sdk.signIn.mockResolvedValueOnce({
        data: { idToken: 'id-token' }
      });
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id', requirePlayServices: false });
      await gs.signIn();
      expect(sdk.hasPlayServices).not.toHaveBeenCalled();
    });
  });

  describe('signOut()', () => {
    it('no-ops when never configured', async () => {
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      await gs.signOut();
      expect(sdk.signOut).not.toHaveBeenCalled();
    });

    it('delegates to the SDK once configured', async () => {
      const gs = createGoogleSignIn({ sdk: asSdk(sdk) });
      gs.configure({ webClientId: 'web-id' });
      await gs.signOut();
      expect(sdk.signOut).toHaveBeenCalledOnce();
    });
  });

  describe('error class', () => {
    it('exposes the code on GoogleSignInError instances', () => {
      const err = new GoogleSignInError('cancelled', 'test');
      expect(err).toBeInstanceOf(GoogleSignInError);
      expect(err.code).toBe('cancelled');
      expect(err.name).toBe('GoogleSignInError');
    });
  });
});
