import { StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { useOperatorStore } from '../state/operator-store';
import { apiClient } from '../services/api-client';
import { colors, spacing, typography } from '../theme/tokens';

export function SettingsScreen() {
  const {
    authSession,
    dashboardTransportMode,
    lastSyncAt,
    readiness,
    transportMessage,
    useMocks
  } = useOperatorStore();

  return (
    <ScreenShell
      eyebrow="Bootstrap Settings"
      subtitle="This screen exposes the current scaffold assumptions rather than pretending production readiness."
      title="Settings"
    >
      <SectionCard eyebrow="Environment" title="Runtime inputs">
        <View style={styles.inline}>
          <StatusPill
            label={useMocks ? 'Mocks enabled' : 'Live API mode'}
            tone={useMocks ? 'warning' : 'live'}
          />
          <StatusPill
            label={
              authSession.authenticated ? 'Authenticated operator' : authSession.source
            }
            tone={authSession.authenticated ? 'live' : 'warning'}
          />
        </View>
        <Text style={styles.copy}>API base URL: {apiClient.env.EXPO_PUBLIC_API_BASE_URL}</Text>
        <Text style={styles.copy}>Transport mode: {dashboardTransportMode}</Text>
        <Text style={styles.copy}>
          Last dashboard sync: {lastSyncAt ?? 'Not synced yet'}
        </Text>
        <Text style={styles.copy}>
          Readiness: {readiness?.status ?? 'Unknown'} ({transportMessage ?? 'No transport note'})
        </Text>
      </SectionCard>

      <SectionCard eyebrow="Next" title="Not wired yet">
        <Text style={styles.copy}>
          Authentication, approvals, push notifications, and live deployment controls are
          intentionally not implemented in this bootstrap scaffold.
        </Text>
      </SectionCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: colors.inkMuted,
    fontSize: typography.body,
    lineHeight: 22
  },
  inline: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm
  }
});
