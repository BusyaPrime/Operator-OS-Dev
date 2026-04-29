import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PollingNetworkChangeDetector,
  type NetworkChangeEvent
} from '../network-change-detector.js';

const silentLogger = pino({ level: 'silent' });

type InterfacesSnapshot = ReturnType<
  typeof import('node:os').networkInterfaces
>;

const buildDetector = (initial: () => InterfacesSnapshot) => {
  let interfacesFactory = initial;
  let intervalCb: (() => void) | undefined;
  const detector = new PollingNetworkChangeDetector({
    logger: silentLogger,
    pollIntervalMs: 5_000,
    interfacesProvider: () => interfacesFactory(),
    clock: () => '2026-04-28T12:00:00.000Z',
    setInterval: ((cb: () => void) => {
      intervalCb = cb;
      return { unref: () => undefined };
    }) as unknown as typeof globalThis.setInterval,
    clearInterval: (() => {
      intervalCb = undefined;
    }) as unknown as typeof globalThis.clearInterval
  });
  return {
    detector,
    setInterfaces(next: () => InterfacesSnapshot) {
      interfacesFactory = next;
    },
    triggerPoll() {
      intervalCb?.();
    },
    get isPolling() {
      return intervalCb !== undefined;
    }
  };
};

const wifiInterfaces = (): ReturnType<typeof networkInterfaces> => ({
  'Wi-Fi': [
    {
      address: '192.168.1.10',
      family: 'IPv4',
      internal: false,
      mac: 'aa:bb:cc:dd:ee:ff',
      netmask: '255.255.255.0',
      cidr: '192.168.1.10/24'
    } as never
  ],
  'lo': [
    {
      address: '127.0.0.1',
      family: 'IPv4',
      internal: true,
      mac: '00:00:00:00:00:00',
      netmask: '255.0.0.0',
      cidr: '127.0.0.1/8'
    } as never
  ]
});

const ethernetInterfaces = (): ReturnType<typeof networkInterfaces> => ({
  Ethernet: [
    {
      address: '10.0.0.5',
      family: 'IPv4',
      internal: false,
      mac: '11:22:33:44:55:66',
      netmask: '255.255.255.0',
      cidr: '10.0.0.5/24'
    } as never
  ],
  lo: [
    {
      address: '127.0.0.1',
      family: 'IPv4',
      internal: true,
      mac: '00:00:00:00:00:00',
      netmask: '255.0.0.0',
      cidr: '127.0.0.1/8'
    } as never
  ]
});

const noNetwork = (): ReturnType<typeof networkInterfaces> => ({
  lo: [
    {
      address: '127.0.0.1',
      family: 'IPv4',
      internal: true,
      mac: '00:00:00:00:00:00',
      netmask: '255.0.0.0',
      cidr: '127.0.0.1/8'
    } as never
  ]
});

// Convenient type alias for the test fixtures.
type networkInterfaces = ReturnType<typeof require>['os']['networkInterfaces'];

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PollingNetworkChangeDetector — start/stop', () => {
  it('start() begins polling, stop() halts it (idempotent)', () => {
    const fixture = buildDetector(wifiInterfaces);
    expect(fixture.isPolling).toBe(false);

    fixture.detector.start();
    expect(fixture.isPolling).toBe(true);
    fixture.detector.start(); // idempotent
    expect(fixture.isPolling).toBe(true);

    fixture.detector.stop();
    expect(fixture.isPolling).toBe(false);
    fixture.detector.stop(); // idempotent
  });
});

describe('PollingNetworkChangeDetector — initial poll is silent', () => {
  it('does NOT fire onChange on the first poll if interfaces match the start-time snapshot', () => {
    const fixture = buildDetector(wifiInterfaces);
    const events: NetworkChangeEvent[] = [];
    fixture.detector.onChange((e) => events.push(e));
    fixture.detector.start();
    fixture.triggerPoll();
    expect(events).toHaveLength(0);
    fixture.detector.stop();
  });
});

describe('PollingNetworkChangeDetector — change detection', () => {
  it('fires onChange when the interface set changes', () => {
    const fixture = buildDetector(wifiInterfaces);
    const events: NetworkChangeEvent[] = [];
    fixture.detector.onChange((e) => events.push(e));
    fixture.detector.start();

    fixture.setInterfaces(ethernetInterfaces);
    fixture.triggerPoll();
    expect(events).toHaveLength(1);
    expect(events[0]!.previousSignature).toContain('192.168.1.10');
    expect(events[0]!.currentSignature).toContain('10.0.0.5');

    fixture.detector.stop();
  });

  it('fires onChange when an interface goes away (network down)', () => {
    const fixture = buildDetector(wifiInterfaces);
    const events: NetworkChangeEvent[] = [];
    fixture.detector.onChange((e) => events.push(e));
    fixture.detector.start();

    fixture.setInterfaces(noNetwork);
    fixture.triggerPoll();
    expect(events).toHaveLength(1);
    // No non-internal interfaces left.
    expect(events[0]!.currentSignature).toBe('');
    expect(events[0]!.interfaceCount).toBe(0);

    fixture.detector.stop();
  });

  it('does NOT re-fire when the second poll sees the same signature again', () => {
    const fixture = buildDetector(wifiInterfaces);
    const events: NetworkChangeEvent[] = [];
    fixture.detector.onChange((e) => events.push(e));
    fixture.detector.start();

    fixture.setInterfaces(ethernetInterfaces);
    fixture.triggerPoll();
    expect(events).toHaveLength(1);
    fixture.triggerPoll();
    expect(events).toHaveLength(1);

    fixture.detector.stop();
  });

  it('handles a re-attached interface with the same address (signature equality)', () => {
    const fixture = buildDetector(wifiInterfaces);
    const events: NetworkChangeEvent[] = [];
    fixture.detector.onChange((e) => events.push(e));
    fixture.detector.start();

    fixture.setInterfaces(noNetwork);
    fixture.triggerPoll(); // 1 fire
    fixture.setInterfaces(wifiInterfaces);
    fixture.triggerPoll(); // 2 fires (different signature from disconnected state)

    expect(events).toHaveLength(2);
    expect(events[1]!.currentSignature).toContain('192.168.1.10');

    fixture.detector.stop();
  });
});

describe('PollingNetworkChangeDetector — listener safety', () => {
  it('listener throw does not block subsequent listeners', () => {
    const fixture = buildDetector(wifiInterfaces);
    const log: string[] = [];
    fixture.detector.onChange(() => {
      throw new Error('first listener threw');
    });
    fixture.detector.onChange(() => log.push('second-fired'));
    fixture.detector.start();

    fixture.setInterfaces(ethernetInterfaces);
    fixture.triggerPoll();
    expect(log).toEqual(['second-fired']);

    fixture.detector.stop();
  });

  it('onChange returns a working unsubscribe', () => {
    const fixture = buildDetector(wifiInterfaces);
    const log: string[] = [];
    const unsub = fixture.detector.onChange(() => log.push('fired'));
    fixture.detector.start();

    fixture.setInterfaces(ethernetInterfaces);
    fixture.triggerPoll();
    expect(log).toEqual(['fired']);

    unsub();
    fixture.setInterfaces(wifiInterfaces);
    fixture.triggerPoll();
    expect(log).toEqual(['fired']); // no second event

    fixture.detector.stop();
  });
});

describe('PollingNetworkChangeDetector — interfacesProvider failure', () => {
  it('logs and skips a poll when the provider throws', () => {
    let calls = 0;
    const detector = new PollingNetworkChangeDetector({
      logger: silentLogger,
      pollIntervalMs: 5_000,
      interfacesProvider: () => {
        calls += 1;
        if (calls === 1) return wifiInterfaces();
        throw new Error('os.networkInterfaces failed');
      },
      clock: () => '2026-04-28T12:00:00.000Z',
      setInterval: ((cb: () => void) => {
        // expose the callback for manual ticking
        (
          detector as unknown as { __cb: () => void }
        ).__cb = cb;
        return { unref: () => undefined };
      }) as unknown as typeof globalThis.setInterval,
      clearInterval: (() => {
        /* no-op */
      }) as unknown as typeof globalThis.clearInterval
    });
    detector.start();
    // Manually run the second poll which will throw.
    expect(() => detector.pollNow()).not.toThrow();
    detector.stop();
  });
});
