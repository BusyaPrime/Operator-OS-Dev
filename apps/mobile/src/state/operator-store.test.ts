import { describe, expect, it } from 'vitest';

import { useOperatorStore } from './operator-store';

describe('@operator-os/mobile store', () => {
  it('starts with mocked devices', () => {
    expect(useOperatorStore.getState().devicesState.items.length).toBeGreaterThan(0);
  });

  it('updates the selected device', () => {
    useOperatorStore.getState().setSelectedDevice('desktop-2');
    expect(useOperatorStore.getState().selectedDeviceId).toBe('desktop-2');
  });
});
