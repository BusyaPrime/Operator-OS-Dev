import { StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { SectionCard } from '../components/section-card';
import { StatusPill } from '../components/status-pill';
import { useOperatorStore } from '../state/operator-store';
import { colors, spacing, typography } from '../theme/tokens';

export function DevicesScreen() {
  const { devices, selectedDeviceId, setSelectedDevice } = useOperatorStore();

  return (
    <ScreenShell
      eyebrow="Desktop Runtime"
      subtitle="Every device entry shows a visible runtime state and declared capabilities."
      title="Devices"
    >
      {devices.map((device) => (
        <SectionCard
          eyebrow={device.platform}
          key={device.deviceId}
          right={
            <StatusPill
              label={device.runtimeStatus}
              tone={device.runtimeStatus === 'ready' ? 'live' : 'warning'}
            />
          }
          title={device.displayName}
        >
          <Text style={styles.copy}>Agent version {device.agentVersion}</Text>
          <View style={styles.inline}>
            {device.capabilities.map((capability) => (
              <StatusPill key={capability} label={capability} tone="info" />
            ))}
          </View>
          <Text
            onPress={() => setSelectedDevice(device.deviceId)}
            style={[
              styles.select,
              selectedDeviceId === device.deviceId && styles.selectActive
            ]}
          >
            {selectedDeviceId === device.deviceId
              ? 'Selected in operator store'
              : 'Select device'}
          </Text>
        </SectionCard>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  copy: {
    color: colors.inkMuted,
    fontSize: typography.body
  },
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  select: {
    color: colors.copperDeep,
    fontSize: typography.body,
    fontWeight: '700'
  },
  selectActive: {
    color: colors.moss
  }
});
