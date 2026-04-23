import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { parseMobileEnv } from '@operator-os/config';

import { GoogleSignInError, googleSignIn } from '../../auth/google-signin';
import { useAuthStore } from '../../state/auth-store';
import { colors, radii, spacing, typography } from '../../theme/tokens';

const env = parseMobileEnv(process.env as Record<string, string | undefined>);

interface LocalErrorState {
  readonly code: string;
  readonly message: string;
}

/**
 * The entry screen for unauthenticated users. Renders the
 * Google Sign-In call-to-action plus a running error banner
 * that surfaces both store-level failures (auth-gateway
 * rejection) and local-level ones (user cancelled the picker,
 * Play Services missing, etc.).
 *
 * The native Google Sign-In SDK is configured the first time
 * this screen mounts — lazy so the app can still boot on
 * devices / envs without a webClientId (dev, CI), showing a
 * disabled button with a clear "Google Sign-In not configured"
 * banner instead of crashing at import.
 */
export function SignInScreen() {
  const status = useAuthStore((state) => state.status);
  const storeError = useAuthStore((state) => state.error);
  const signInWithGoogleIdToken = useAuthStore(
    (state) => state.signInWithGoogleIdToken
  );
  const clearError = useAuthStore((state) => state.clearError);

  const [localError, setLocalError] = useState<LocalErrorState | undefined>();
  const [configured, setConfigured] = useState(googleSignIn.isConfigured());

  const webClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  useEffect(() => {
    if (configured || webClientId === undefined) return;
    googleSignIn.configure({ webClientId, iosClientId });
    setConfigured(true);
  }, [configured, iosClientId, webClientId]);

  const isBusy = status === 'authenticating';
  const combinedError = useMemo<LocalErrorState | undefined>(() => {
    if (localError) return localError;
    if (storeError) return storeError;
    return undefined;
  }, [localError, storeError]);

  const onPressSignIn = useCallback(async () => {
    setLocalError(undefined);
    if (storeError) clearError();
    try {
      const result = await googleSignIn.signIn();
      await signInWithGoogleIdToken(result.idToken);
    } catch (err) {
      if (err instanceof GoogleSignInError) {
        if (err.code === 'cancelled') {
          // User chose "Cancel" on the picker — silent no-op.
          return;
        }
        setLocalError({ code: err.code, message: errorCopy(err.code) });
        return;
      }
      setLocalError({
        code: 'unknown',
        message: errorCopy('unknown')
      });
    }
  }, [clearError, signInWithGoogleIdToken, storeError]);

  return (
    <View style={styles.container} testID="sign-in-screen">
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Operator OS</Text>
        <Text style={styles.title}>Sign in to take control</Text>
        <Text style={styles.subtitle}>
          Google sign-in keeps your session tied to the same account
          that provisions your Cloud Run + Vertex resources. Tokens are
          stored in the device keychain; the operator shell never
          touches your Google password.
        </Text>
      </View>

      {combinedError !== undefined ? (
        <View style={styles.errorBanner} testID="sign-in-error">
          <Text style={styles.errorCode}>Sign-in failed · {combinedError.code}</Text>
          <Text style={styles.errorMessage}>{combinedError.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        disabled={isBusy || webClientId === undefined}
        onPress={onPressSignIn}
        style={({ pressed }) => [
          styles.button,
          (isBusy || webClientId === undefined) && styles.buttonDisabled,
          pressed && !isBusy && styles.buttonPressed
        ]}
        testID="google-sign-in-button"
      >
        {isBusy ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonLabel}>Continue with Google</Text>
        )}
      </Pressable>

      {webClientId === undefined ? (
        <Text style={styles.configNote} testID="sign-in-config-note">
          Google Sign-In is not configured for this build. Set
          EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID before signing in.
        </Text>
      ) : null}
    </View>
  );
}

const errorCopy = (code: string): string => {
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
      return "The server rejected the sign-in request. Please try again.";
    case 'server':
      return 'The authentication service is temporarily unavailable.';
    case 'malformed-response':
      return 'The authentication server returned an unexpected response.';
    default:
      return 'Something went wrong. Please try again.';
  }
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.copperDeep,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg
  },
  buttonDisabled: {
    opacity: 0.45
  },
  buttonLabel: {
    color: colors.white,
    fontSize: typography.body + 1,
    fontWeight: '800',
    letterSpacing: 0.4
  },
  buttonPressed: {
    opacity: 0.8
  },
  configNote: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  container: {
    backgroundColor: colors.canvas,
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.lg
  },
  errorBanner: {
    backgroundColor: '#f6d8cf',
    borderRadius: radii.md,
    gap: spacing.xs,
    padding: spacing.md
  },
  errorCode: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  errorMessage: {
    color: colors.ink,
    fontSize: typography.body,
    lineHeight: 22
  },
  eyebrow: {
    color: colors.copperDeep,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase'
  },
  hero: {
    gap: spacing.sm
  },
  subtitle: {
    color: colors.inkMuted,
    fontSize: typography.body,
    lineHeight: 22
  },
  title: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '800'
  }
});
