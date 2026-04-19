import { StyleSheet, Text } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { useOperatorStore } from '../state/operator-store';
import { colors, typography } from '../theme/tokens';

export function SessionsScreen() {
  const { sessions } = useOperatorStore();

  return (
    <ScreenShell
      eyebrow="Visible Sessions"
      subtitle="Sessions stay explicit, inspectable, and approval-aware."
      title="Sessions"
    >
      {sessions.map((session) => (
        <SectionCard
          eyebrow={session.mode}
          key={session.id}
          right={
            <StatusPill
              label={session.status}
              tone={session.status === 'active' ? 'live' : 'warning'}
            />
          }
          title={session.id}
        >
          <Text style={styles.copy}>Device: {session.deviceId}</Text>
          <Text style={styles.copy}>Operator: {session.operatorId}</Text>
          <Text style={styles.copy}>Visibility: {session.visibility}</Text>
        </SectionCard>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: colors.inkMuted,
    fontSize: typography.body
  }
});
