import { describe, expect, it } from 'vitest';

import { categorizeDisconnect } from '../disconnect-categorizer.js';

const errWithCode = (code: string, message = 'simulated'): Error & {
  code: string;
} => {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
};

describe('categorizeDisconnect — intentional precedence', () => {
  it('always returns INTENTIONAL when the flag is set, regardless of error/closeCode', () => {
    expect(
      categorizeDisconnect({
        intentional: true,
        error: errWithCode('ECONNRESET'),
        closeCode: 1006
      })
    ).toBe('INTENTIONAL');
  });
});

describe('categorizeDisconnect — error codes', () => {
  it('maps ENETUNREACH / EHOSTUNREACH / ENETDOWN to NETWORK_DOWN', () => {
    expect(categorizeDisconnect({ error: errWithCode('ENETUNREACH') })).toBe(
      'NETWORK_DOWN'
    );
    expect(categorizeDisconnect({ error: errWithCode('EHOSTUNREACH') })).toBe(
      'NETWORK_DOWN'
    );
    expect(categorizeDisconnect({ error: errWithCode('ENETDOWN') })).toBe(
      'NETWORK_DOWN'
    );
  });

  it('maps ENOTFOUND / EAI_AGAIN to DNS_FAILURE', () => {
    expect(categorizeDisconnect({ error: errWithCode('ENOTFOUND') })).toBe(
      'DNS_FAILURE'
    );
    expect(categorizeDisconnect({ error: errWithCode('EAI_AGAIN') })).toBe(
      'DNS_FAILURE'
    );
  });

  it('maps ECONNREFUSED / ETIMEDOUT / ECONNRESET to SERVER_UNREACHABLE', () => {
    expect(categorizeDisconnect({ error: errWithCode('ECONNREFUSED') })).toBe(
      'SERVER_UNREACHABLE'
    );
    expect(categorizeDisconnect({ error: errWithCode('ETIMEDOUT') })).toBe(
      'SERVER_UNREACHABLE'
    );
    expect(categorizeDisconnect({ error: errWithCode('ECONNRESET') })).toBe(
      'SERVER_UNREACHABLE'
    );
  });

  it('maps ERR_TLS_* / ERR_SSL_PROTOCOL_ERROR / cert errors to TLS_HANDSHAKE_FAIL', () => {
    expect(
      categorizeDisconnect({ error: errWithCode('ERR_TLS_CERT_ALTNAME_INVALID') })
    ).toBe('TLS_HANDSHAKE_FAIL');
    expect(
      categorizeDisconnect({ error: errWithCode('ERR_SSL_PROTOCOL_ERROR') })
    ).toBe('TLS_HANDSHAKE_FAIL');
    expect(
      categorizeDisconnect({ error: errWithCode('CERT_HAS_EXPIRED') })
    ).toBe('TLS_HANDSHAKE_FAIL');
  });
});

describe('categorizeDisconnect — error message patterns', () => {
  it('parses the ws library "Unexpected server response: <status>" line', () => {
    expect(
      categorizeDisconnect({
        error: new Error('Unexpected server response: 401')
      })
    ).toBe('SERVER_REJECTED');
    expect(
      categorizeDisconnect({
        error: new Error('Unexpected server response: 403')
      })
    ).toBe('SERVER_REJECTED');
    expect(
      categorizeDisconnect({
        error: new Error('Unexpected server response: 500')
      })
    ).toBe('SERVER_UNREACHABLE');
    expect(
      categorizeDisconnect({
        error: new Error('Unexpected server response: 502')
      })
    ).toBe('SERVER_UNREACHABLE');
  });

  it('matches "timeout" in the error message to CLIENT_TIMEOUT', () => {
    expect(
      categorizeDisconnect({ error: new Error('connection timeout reached') })
    ).toBe('CLIENT_TIMEOUT');
  });
});

describe('categorizeDisconnect — close codes', () => {
  it('1000 / 1001 → INTENTIONAL', () => {
    expect(categorizeDisconnect({ closeCode: 1000 })).toBe('INTENTIONAL');
    expect(categorizeDisconnect({ closeCode: 1001 })).toBe('INTENTIONAL');
  });

  it('1002 / 1003 / 1007 / 1008 → PROTOCOL_ERROR', () => {
    for (const code of [1002, 1003, 1007, 1008]) {
      expect(categorizeDisconnect({ closeCode: code })).toBe('PROTOCOL_ERROR');
    }
  });

  it('1006 / 1011..1014 → SERVER_UNREACHABLE', () => {
    for (const code of [1006, 1011, 1012, 1013, 1014]) {
      expect(categorizeDisconnect({ closeCode: code })).toBe(
        'SERVER_UNREACHABLE'
      );
    }
  });

  it('1015 → TLS_HANDSHAKE_FAIL', () => {
    expect(categorizeDisconnect({ closeCode: 1015 })).toBe(
      'TLS_HANDSHAKE_FAIL'
    );
  });

  it('4xxx (custom server codes) → PROTOCOL_ERROR', () => {
    expect(categorizeDisconnect({ closeCode: 4001 })).toBe('PROTOCOL_ERROR');
    expect(categorizeDisconnect({ closeCode: 4002 })).toBe('PROTOCOL_ERROR');
    expect(categorizeDisconnect({ closeCode: 4999 })).toBe('PROTOCOL_ERROR');
  });

  it('unknown close code in the 1xxx range falls through to UNKNOWN', () => {
    // 1016 isn't in our explicit map.
    expect(categorizeDisconnect({ closeCode: 1016 })).toBe('UNKNOWN');
  });
});

describe('categorizeDisconnect — fall-through', () => {
  it('returns UNKNOWN when no inputs identify the cause', () => {
    expect(categorizeDisconnect({})).toBe('UNKNOWN');
  });
});

describe('categorizeDisconnect — error precedence over closeCode', () => {
  it('error.code wins over closeCode when both present', () => {
    // ECONNREFUSED + 1006 (abnormal close) — both could
    // map differently; error.code is more specific.
    expect(
      categorizeDisconnect({
        error: errWithCode('ECONNREFUSED'),
        closeCode: 1006
      })
    ).toBe('SERVER_UNREACHABLE');
  });
});
