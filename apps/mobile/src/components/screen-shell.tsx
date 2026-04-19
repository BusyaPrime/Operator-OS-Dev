import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

interface ScreenShellProps extends PropsWithChildren {
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function ScreenShell({
  children,
  eyebrow,
  title,
  subtitle
}: ScreenShellProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={[colors.ink, '#1c2a34', colors.copperDeep]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.hero}
      >
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </LinearGradient>
      <View style={styles.stack}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.canvas
  },
  content: {
    gap: spacing.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl
  },
  eyebrow: {
    color: '#efcfb8',
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase'
  },
  hero: {
    borderRadius: radii.lg,
    gap: spacing.sm,
    padding: spacing.lg
  },
  stack: {
    gap: spacing.md
  },
  subtitle: {
    color: '#f4ede5',
    fontSize: typography.body,
    lineHeight: 22
  },
  title: {
    color: colors.white,
    fontSize: typography.title,
    fontWeight: '800'
  }
});
