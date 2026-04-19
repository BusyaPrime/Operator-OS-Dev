import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { useOperatorStore } from '../state/operator-store';
import { colors, spacing, typography } from '../theme/tokens';

export function HomeScreen() {
  const {
    alerts,
    costs,
    dashboardTransportMode,
    devices,
    health,
    refreshDashboard,
    sessions,
    transportMessage
  } = useOperatorStore();

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  return (
    <ScreenShell
      eyebrow="Trusted Operator"
      subtitle="A visible control surface for runtimes, costs, sessions, and approvals."
      title="Operator cockpit"
    >
      <SectionCard eyebrow="Overview" title="Control plane">
        <View style={styles.metricRow}>
          <Metric label="Devices" value={String(devices.length)} />
          <Metric label="Sessions" value={String(sessions.length)} />
          <Metric
            label="Open alerts"
            value={String(alerts.filter((alert) => alert.status === 'open').length)}
          />
        </View>
        <View style={styles.inline}>
          <StatusPill
            label={health?.status === 'ok' ? 'API healthy' : 'Awaiting check'}
            tone={health?.status === 'ok' ? 'live' : 'warning'}
          />
          <StatusPill
            label={
              dashboardTransportMode === 'live-api'
                ? 'Live API mode'
                : 'Controlled fallback'
            }
            tone={dashboardTransportMode === 'live-api' ? 'live' : 'warning'}
          />
          <StatusPill
            label={`Spend $${costs[0]?.totalUsd.toFixed(2) ?? '0.00'}`}
            tone="info"
          />
        </View>
        {transportMessage ? <Text style={styles.copy}>{transportMessage}</Text> : null}
      </SectionCard>

      <SectionCard eyebrow="Why this exists" title="Trust boundary">
        <Text style={styles.copy}>
          No hidden takeover, no spyware behavior, and no background keylogging.
          This shell is meant to show explicit state and require deliberate actions.
        </Text>
      </SectionCard>
    </ScreenShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
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
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  metricCard: {
    backgroundColor: colors.cardStrong,
    borderRadius: 20,
    flex: 1,
    minHeight: 88,
    padding: spacing.md
  },
  metricLabel: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    textTransform: 'uppercase'
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  metricValue: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800'
  }
});
