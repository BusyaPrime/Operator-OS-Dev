import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

const paletteByTone = {
  critical: { backgroundColor: '#f6d8cf', color: colors.danger },
  info: { backgroundColor: '#dde6ec', color: colors.sky },
  live: { backgroundColor: '#dce7d5', color: colors.moss },
  warning: { backgroundColor: '#f8e1d0', color: colors.copperDeep }
} as const;

type StatusTone = keyof typeof paletteByTone;

interface StatusPillProps {
  label: string;
  tone: StatusTone;
}

export function StatusPill({ label, tone }: StatusPillProps) {
  const palette = paletteByTone[tone];

  return (
    <View style={[styles.pill, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.label, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  }
});
