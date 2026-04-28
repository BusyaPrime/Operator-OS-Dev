import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  ConnectionStateMachine,
  type StateChangeEvent
} from '../connection-state-machine.js';

const silentLogger = pino({ level: 'silent' });

const mk = () =>
  new ConnectionStateMachine({
    logger: silentLogger,
    clock: () => '2026-04-28T12:00:00.000Z'
  });

describe('ConnectionStateMachine — initial state', () => {
  it('starts in DISCONNECTED', () => {
    const sm = mk();
    expect(sm.state).toBe('DISCONNECTED');
    expect(sm.isTerminal).toBe(false);
    expect(sm.canSend).toBe(false);
  });
});

describe('ConnectionStateMachine — happy path lifecycle', () => {
  it('walks DISCONNECTED -> CONNECTING -> CONNECTED -> DISCONNECTING -> DISCONNECTED', () => {
    const sm = mk();
    const seen: StateChangeEvent[] = [];
    sm.subscribe((e) => seen.push(e));

    expect(
      sm.request({ to: 'CONNECTING', reason: 'operator-start' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('CONNECTING');
    expect(sm.canSend).toBe(false);

    expect(sm.request({ to: 'CONNECTED', reason: 'welcome-frame' }).kind).toBe(
      'accepted'
    );
    expect(sm.state).toBe('CONNECTED');
    expect(sm.canSend).toBe(true);

    expect(
      sm.request({ to: 'DISCONNECTING', reason: 'operator-stop' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('DISCONNECTING');

    expect(
      sm.request({ to: 'DISCONNECTED', reason: 'socket-closed' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('DISCONNECTED');

    expect(seen).toHaveLength(4);
    expect(seen.map((e) => e.to)).toEqual([
      'CONNECTING',
      'CONNECTED',
      'DISCONNECTING',
      'DISCONNECTED'
    ]);
  });
});

describe('ConnectionStateMachine — DEGRADED', () => {
  it('CONNECTED <-> DEGRADED is bidirectional', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'CONNECTED', reason: 'welcome' });

    expect(
      sm.request({ to: 'DEGRADED', reason: 'rtt-p95-over-threshold' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('DEGRADED');
    expect(sm.canSend).toBe(true); // frames still flow

    expect(
      sm.request({ to: 'CONNECTED', reason: 'rtt-recovered' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('CONNECTED');
  });

  it('DEGRADED -> DISCONNECTED on close', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'CONNECTED', reason: 'welcome' });
    sm.request({ to: 'DEGRADED', reason: 'rtt-spike' });
    expect(
      sm.request({ to: 'DISCONNECTED', reason: 'transport-close-1006' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('DISCONNECTED');
  });
});

describe('ConnectionStateMachine — REVOKED is absorbing', () => {
  it('reaches REVOKED from CONNECTING (upgrade-401)', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    expect(
      sm.request({ to: 'REVOKED', reason: 'upgrade-401' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('REVOKED');
    expect(sm.isTerminal).toBe(true);
    expect(sm.canSend).toBe(false);
  });

  it('reaches REVOKED from CONNECTED (close 4001)', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'CONNECTED', reason: 'welcome' });
    expect(
      sm.request({ to: 'REVOKED', reason: 'close-4001' }).kind
    ).toBe('accepted');
    expect(sm.state).toBe('REVOKED');
  });

  it('reaches REVOKED from DEGRADED (close 4001)', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'CONNECTED', reason: 'welcome' });
    sm.request({ to: 'DEGRADED', reason: 'rtt-spike' });
    expect(
      sm.request({ to: 'REVOKED', reason: 'close-4001' }).kind
    ).toBe('accepted');
  });

  it('refuses any transition out of REVOKED', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'REVOKED', reason: '401' });

    for (const target of [
      'DISCONNECTED',
      'CONNECTING',
      'CONNECTED',
      'DEGRADED',
      'DISCONNECTING'
    ] as const) {
      const out = sm.request({ to: target, reason: 'recovery-attempt' });
      expect(out.kind).toBe('rejected');
      if (out.kind === 'rejected') {
        expect(out.reason).toMatch(/REVOKED/);
      }
      expect(sm.state).toBe('REVOKED');
    }
  });
});

describe('ConnectionStateMachine — illegal transitions are rejected, not thrown', () => {
  it('DISCONNECTED -> CONNECTED directly is rejected', () => {
    const sm = mk();
    const out = sm.request({ to: 'CONNECTED', reason: 'shortcut' });
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') {
      expect(out.reason).toContain('not allowed');
    }
    expect(sm.state).toBe('DISCONNECTED');
  });

  it('CONNECTING -> DEGRADED is rejected (welcome must come first)', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    const out = sm.request({ to: 'DEGRADED', reason: 'rtt-early' });
    expect(out.kind).toBe('rejected');
    expect(sm.state).toBe('CONNECTING');
  });
});

describe('ConnectionStateMachine — same-state transition is benign', () => {
  it('CONNECTED -> CONNECTED returns accepted but does not notify listeners', () => {
    const sm = mk();
    sm.request({ to: 'CONNECTING', reason: 'op' });
    sm.request({ to: 'CONNECTED', reason: 'welcome' });
    const seen: StateChangeEvent[] = [];
    sm.subscribe((e) => seen.push(e));
    const out = sm.request({ to: 'CONNECTED', reason: 'redundant' });
    expect(out.kind).toBe('accepted');
    expect(seen).toHaveLength(0);
  });
});

describe('ConnectionStateMachine — listener safety', () => {
  it('listener throw does not prevent further listeners', () => {
    const sm = mk();
    const log: string[] = [];
    sm.subscribe(() => {
      throw new Error('first listener threw');
    });
    sm.subscribe(() => {
      log.push('second-fired');
    });
    sm.request({ to: 'CONNECTING', reason: 'op' });
    expect(log).toEqual(['second-fired']);
  });

  it('subscribe returns a working unsubscribe', () => {
    const sm = mk();
    const log: string[] = [];
    const unsub = sm.subscribe(() => log.push('fired'));
    sm.request({ to: 'CONNECTING', reason: 'a' });
    unsub();
    sm.request({ to: 'CONNECTED', reason: 'b' });
    expect(log).toEqual(['fired']);
  });
});

describe('ConnectionStateMachine — clock injection', () => {
  it('uses the injected clock for the at field', () => {
    const sm = new ConnectionStateMachine({
      logger: silentLogger,
      clock: () => '2030-01-01T00:00:00.000Z'
    });
    let received: StateChangeEvent | undefined;
    sm.subscribe((e) => {
      received = e;
    });
    sm.request({ to: 'CONNECTING', reason: 'op' });
    expect(received?.at).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('ConnectionStateMachine — metadata pass-through', () => {
  it('metadata is included on the event when supplied', () => {
    const sm = mk();
    let received: StateChangeEvent | undefined;
    sm.subscribe((e) => {
      received = e;
    });
    sm.request({
      to: 'CONNECTING',
      reason: 'op',
      metadata: { attempt: 3, lastDisconnectCategory: 'NETWORK_DOWN' }
    });
    expect(received?.metadata).toEqual({
      attempt: 3,
      lastDisconnectCategory: 'NETWORK_DOWN'
    });
  });
});

// Force vi to import — keeps the lint hook happy when no
// explicit vi.* call is otherwise used in this file.
void vi;
