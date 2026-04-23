import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { parseMobileEnv } from '@operator-os/config';

import { googleSignIn } from '../../auth/google-signin';
import { colors, radii, spacing, typography } from '../../theme/tokens';

import { useSignInHandlers } from './use-sign-in-handlers';

const env = parseMobileEnv(process.env as Record<string, string | undefined>);

/**
 * Entry screen for unauthenticated users. All flow logic lives
 * in `useSignInHandlers`; this component is a render shell that
 * wires the hook's outputs to copper-palette React Native UI.
 *
 * Configuration gate: if `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is
 * unset (dev / CI), the button renders disabled with a small
 * note. Prevents a boot-time crash from a missing env var.
 */
export function SignInScreen() {
  const { onPressSignIn, combinedError, isBusy } = useSignInHandlers();
  const [configured, setConfigured] = useState(googleSignIn.isConfigured());

  const webClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  useEffect(() => {
    if (configured || webClientId === undefined) return;
    googleSignIn.configure({ webClientId, iosClientId });
    setConfigured(true);
  }, [configured, iosClientId, webClientId]);

  const buttonDisabled = isBusy || webClientId === undefined;

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
        <View style={styles.errorBanner} testID="error-banner">
          <Text style={styles.errorCode}>
            Sign-in failed · {combinedError.code}
          </Text>
          <Text style={styles.errorMessage}>{combinedError.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        disabled={buttonDisabled}
        onPress={onPressSignIn}
        style={({ pressed }) => [
          styles.button,
          buttonDisabled && styles.buttonDisabled,
          pressed && !buttonDisabled && styles.buttonPressed
        ]}
        testID="sign-in-button"
      >
        {isBusy ? (
          <ActivityIndicator color={colors.white} testID="loading-spinner" />
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
