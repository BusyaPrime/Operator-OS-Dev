import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

interface SectionCardProps extends PropsWithChildren {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}

export function SectionCard({
  children,
  eyebrow,
  title,
  right
}: SectionCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        {right}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18
  },
  eyebrow: {
    color: colors.copperDeep,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: spacing.xs,
    textTransform: 'uppercase'
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  title: {
    color: colors.ink,
    fontSize: typography.section,
    fontWeight: '800'
  }
});
