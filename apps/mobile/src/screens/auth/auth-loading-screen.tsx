import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '../../state/auth-store';
import { colors, spacing, typography } from '../../theme/tokens';

/**
 * Shown at app launch while the auth-store restores its session
 * (reads refresh token from the keychain, calls /v1/auth/refresh).
 * Once bootstrap() settles, the root navigator swaps this screen
 * for either SignInScreen (unauthenticated) or the tab shell
 * (authenticated).
 *
 * This screen is deliberately static — no copy that promises an
 * action the user could take. It exists only so the user sees a
 * branded surface instead of a blank splash while we decide.
 */
export function AuthLoadingScreen() {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    // Fire once on mount. The store itself is idempotent: a
    // second bootstrap while authenticated is a no-op, but we
    // still avoid calling it more than once per mount.
    void bootstrap();
  }, [bootstrap]);

  return (
    <View style={styles.container} testID="auth-loading-screen">
      <Text style={styles.eyebrow}>Operator OS</Text>
      <Text style={styles.title}>Restoring your session…</Text>
      <ActivityIndicator
        color={colors.copper}
        size="large"
        style={styles.spinner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg
  },
  eyebrow: {
    color: colors.copperDeep,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase'
  },
  spinner: {
    marginTop: spacing.md
  },
  title: {
    color: colors.ink,
    fontSize: typography.section,
    fontWeight: '700',
    textAlign: 'center'
  }
});
