/**
 * Pure error-code → user-copy mapper for SignInScreen.
 *
 * Extracted from SignInScreen so the mapping is testable in
 * isolation — no React, no native SDK. Every AuthClientError.code
 * and GoogleSignInError.code that the screen can surface has a
 * case here; an unrecognised code falls through to the generic
 * "Something went wrong" copy so the user is never shown a raw
 * internal code as their primary message.
 */
export const errorCopy = (code: string): string => {
  switch (code) {
    case 'in-progress':
      return 'Another sign-in is already in progress. Please wait.';
    case 'play-services-unavailable':
      return 'Google Play Services is unavailable on this device.';
    case 'not-configured':
      return 'Google Sign-In is not configured yet.';
    case 'no-id-token':
      return 'Google did not return a sign-in token. Please try again.';
    case 'network':
      return 'Cannot reach the authentication server. Check your connection.';
    case 'timeout':
      return 'The authentication request timed out. Please try again.';
    case 'invalid-credentials':
      return 'Your session was rejected. Please sign in again.';
    case 'bad-request':
      return 'The server rejected the sign-in request. Please try again.';
    case 'server':
      return 'The authentication service is temporarily unavailable.';
    case 'malformed-response':
      return 'The authentication server returned an unexpected response.';
    default:
      return 'Something went wrong. Please try again.';
  }
};

/** Structured error shape the SignInScreen renders in its banner. */
export interface SignInErrorMessage {
  readonly code: string;
  readonly message: string;
}

/**
 * Helper: wrap an arbitrary error code into the UI-ready shape.
 * Used by the hook's orchestrator so callers don't repeat the
 * `{ code, message: errorCopy(code) }` literal.
 */
export const signInErrorFor = (code: string): SignInErrorMessage => ({
  code,
  message: errorCopy(code)
});
