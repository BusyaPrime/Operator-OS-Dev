import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes
} from '@react-native-google-signin/google-signin';

/**
 * Thin wrapper around @react-native-google-signin/google-signin.
 *
 * Why wrap: the native SDK surfaces errors through opaque
 * `statusCodes` plus free-form messages. The rest of the app
 * (SignInScreen, auth-store) should branch on a domain-specific
 * `GoogleSignInErrorCode` — not on the SDK's internal enum.
 *
 * Why `configure` is a method (not called at module load): the
 * SDK's `configure` expects valid client IDs, and during
 * development / CI those may be missing. Calling it lazily means
 * the app can boot in a "sign-in button disabled" state rather
 * than crashing on startup.
 */

export type GoogleSignInErrorCode =
  | 'cancelled'        // user dismissed the picker
  | 'in-progress'      // another sign-in is already running
  | 'play-services-unavailable' // Android without Play Services
  | 'not-configured'   // configure() wasn't called first
  | 'no-id-token'      // SDK returned but with no idToken field
  | 'unknown';

export class GoogleSignInError extends Error {
  readonly code: GoogleSignInErrorCode;
  constructor(code: GoogleSignInErrorCode, message: string) {
    super(message);
    this.name = 'GoogleSignInError';
    this.code = code;
  }
}

export interface GoogleSignInResult {
  /** The Google-issued ID JWT — fed to auth-gateway /v1/auth/signin. */
  readonly idToken: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly photoUrl?: string;
}

export interface GoogleSignInConfig {
  readonly webClientId: string;
  readonly iosClientId?: string;
  /** When false, SDK skips Play Services check on Android (dev only). */
  readonly requirePlayServices?: boolean;
}

export interface GoogleSignInModule {
  configure(config: GoogleSignInConfig): void;
  signIn(): Promise<GoogleSignInResult>;
  signOut(): Promise<void>;
  isConfigured(): boolean;
}

/**
 * Minimal shape we need from the SDK. Keeping this local instead
 * of relying on the vendor types means if the SDK introduces a
 * breaking shape change, the compiler tells us exactly here.
 * Exported so tests can construct a typed fake.
 */
export interface RawGoogleSDK {
  configure(options: {
    webClientId: string;
    iosClientId?: string;
  }): void;
  hasPlayServices(options?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
  signIn(): Promise<{
    data?: {
      idToken?: string | null;
      user?: {
        email?: string;
        name?: string;
        photo?: string | null;
      };
    } | null;
  } | null>;
  signOut(): Promise<void>;
}

export interface CreateGoogleSignInOptions {
  /** Injectable for tests; defaults to the real SDK. */
  readonly sdk?: RawGoogleSDK;
}

const defaultSdk: RawGoogleSDK =
  GoogleSignin as unknown as RawGoogleSDK;

export const createGoogleSignIn = (
  options: CreateGoogleSignInOptions = {}
): GoogleSignInModule => {
  const sdk = options.sdk ?? defaultSdk;
  let configured = false;
  let requirePlayServices = true;

  return {
    configure(config: GoogleSignInConfig): void {
      sdk.configure({
        webClientId: config.webClientId,
        iosClientId: config.iosClientId
      });
      requirePlayServices = config.requirePlayServices ?? true;
      configured = true;
    },

    isConfigured(): boolean {
      return configured;
    },

    async signIn(): Promise<GoogleSignInResult> {
      if (!configured) {
        throw new GoogleSignInError(
          'not-configured',
          'GoogleSignIn.signIn() called before configure()'
        );
      }

      // Play Services check is Android-specific; on iOS the SDK
      // no-ops it and returns true. We still call it so a missing
      // Play Services on Android surfaces before the picker opens.
      if (requirePlayServices) {
        try {
          await sdk.hasPlayServices({ showPlayServicesUpdateDialog: true });
        } catch (err) {
          throw mapSdkError(err);
        }
      }

      let response: Awaited<ReturnType<RawGoogleSDK['signIn']>>;
      try {
        response = await sdk.signIn();
      } catch (err) {
        throw mapSdkError(err);
      }

      // SDK v13+ wraps the payload in `{ data: { ... } }`; older
      // builds may return the inner object directly. Normalise
      // both shapes into a single `user + idToken` bag.
      const data = normaliseSignInResponse(response);
      if (
        data?.idToken === undefined ||
        data.idToken === null ||
        data.idToken.length === 0
      ) {
        throw new GoogleSignInError(
          'no-id-token',
          'Google Sign-In returned no idToken'
        );
      }

      return {
        idToken: data.idToken,
        email: data.user?.email,
        displayName: data.user?.name,
        photoUrl: data.user?.photo ?? undefined
      };
    },

    async signOut(): Promise<void> {
      if (!configured) {
        // Signing out of something you never signed into is fine.
        return;
      }
      await sdk.signOut();
    }
  };
};

interface NormalisedSignInData {
  idToken?: string | null;
  user?: {
    email?: string;
    name?: string;
    photo?: string | null;
  };
}

const normaliseSignInResponse = (
  response: Awaited<ReturnType<RawGoogleSDK['signIn']>>
): NormalisedSignInData | null => {
  if (response === null || response === undefined) return null;
  // v13+: { data: { idToken, user } }
  const maybeWrapped = response as { data?: NormalisedSignInData };
  if ('data' in response && maybeWrapped.data) {
    return maybeWrapped.data;
  }
  // Older shape: object is the inner payload itself.
  return response as NormalisedSignInData;
};

const mapSdkError = (err: unknown): GoogleSignInError => {
  if (isErrorWithCode(err)) {
    switch (err.code) {
      case statusCodes.SIGN_IN_CANCELLED:
        return new GoogleSignInError('cancelled', err.message);
      case statusCodes.IN_PROGRESS:
        return new GoogleSignInError('in-progress', err.message);
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return new GoogleSignInError(
          'play-services-unavailable',
          err.message
        );
      default:
        return new GoogleSignInError('unknown', err.message);
    }
  }
  return new GoogleSignInError(
    'unknown',
    err instanceof Error ? err.message : 'Unknown Google Sign-In failure'
  );
};

/** Default singleton for convenience — tests call createGoogleSignIn. */
export const googleSignIn = createGoogleSignIn();
