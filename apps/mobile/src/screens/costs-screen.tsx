import { StyleSheet, Text } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { useOperatorStore } from '../state/operator-store';
import { colors, typography } from '../theme/tokens';

export function CostsScreen() {
  const { costsState } = useOperatorStore();

  if (costsState.status === 'loading') {
    return (
      <ScreenShell
        eyebrow="Budget Lens"
        subtitle="Costs and alerts should be visible from the same mobile operator surface."
        title="Costs"
      >
        <SectionCard eyebrow="State" title="Loading">
          <Text style={styles.copy}>Refreshing cost snapshots from the dashboard.</Text>
        </SectionCard>
      </ScreenShell>
    );
  }

  if (costsState.status === 'error') {
    return (
      <ScreenShell
        eyebrow="Budget Lens"
        subtitle="Costs and alerts should be visible from the same mobile operator surface."
        title="Costs"
      >
        <SectionCard eyebrow="State" title="Cost state unavailable">
          <Text style={styles.copy}>{costsState.errorMessage}</Text>
        </SectionCard>
      </ScreenShell>
    );
  }

  if (costsState.status === 'empty') {
    return (
      <ScreenShell
        eyebrow="Budget Lens"
        subtitle="Costs and alerts should be visible from the same mobile operator surface."
        title="Costs"
      >
        <SectionCard eyebrow="State" title="No cost snapshots">
          <Text style={styles.copy}>
            No cost snapshots were returned by the current dashboard payload.
          </Text>
        </SectionCard>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      eyebrow="Budget Lens"
      subtitle="Costs and alerts should be visible from the same mobile operator surface."
      title="Costs"
    >
      {costsState.items.map((cost) => (
        <SectionCard
          eyebrow={cost.scope}
          key={cost.id}
          right={
            <StatusPill
              label={`${cost.alertsOpen} alerts`}
              tone={cost.alertsOpen > 0 ? 'warning' : 'live'}
            />
          }
          title={cost.scopeId}
        >
          <Text style={styles.amount}>${cost.totalUsd.toFixed(2)} USD</Text>
          <Text style={styles.copy}>
            Window: {cost.windowStart.slice(0, 10)} to {cost.windowEnd.slice(0, 10)}
          </Text>
          <Text style={styles.copy}>Budget: {cost.budgetName ?? 'Not linked yet'}</Text>
        </SectionCard>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  amount: {
    color: colors.copperDeep,
    fontSize: 28,
    fontWeight: '800'
  },
  copy: {
    color: colors.inkMuted,
    fontSize: typography.body
  }
});
