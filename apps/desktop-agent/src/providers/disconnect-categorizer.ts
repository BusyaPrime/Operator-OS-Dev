/**
 * Phase 4.0 Part 5.C — categorise WS disconnect events into
 * actionable buckets that ops dashboards (TD-058 Pub/Sub
 * fan-out, future) can group on.
 *
 * The two raw inputs we have at the WS layer:
 *
 *   1. The `Error` from the 'error' event (when the upgrade
 *      or transport fails). Carries `code` + `message`.
 *   2. The numeric `code` from the 'close' event (RFC 6455
 *      close codes 1xxx + custom 4xxx).
 *
 * Both feed into `categorize(...)` which returns a stable
 * enum string. The mapping is best-effort but stable — a
 * wrong classification is always recoverable (the actual
 * reconnect logic doesn't depend on the category, only
 * dashboards do).
 */

export type DisconnectCategory =
  /** No internet detected — ENETUNREACH / EHOSTUNREACH / ENETDOWN. */
  | 'NETWORK_DOWN'
  /** Hostname couldn't resolve — ENOTFOUND / EAI_AGAIN. */
  | 'DNS_FAILURE'
  /** TLS handshake didn't complete — bad cert, version mismatch. */
  | 'TLS_HANDSHAKE_FAIL'
  /** Connection refused / timed out at the transport layer. */
  | 'SERVER_UNREACHABLE'
  /** Server returned a 4xx/5xx on the upgrade response. */
  | 'SERVER_REJECTED'
  /** Server-defined custom close code (4001 = unauthorized, 4002 = hello-invalid, etc.). */
  | 'PROTOCOL_ERROR'
  /** Inactivity / our own ping timeout. */
  | 'CLIENT_TIMEOUT'
  /** Operator stop or system shutdown. */
  | 'INTENTIONAL'
  /** Catch-all for events we couldn't classify. */
  | 'UNKNOWN';

export interface CategorizeInput {
  /** RFC 6455 + custom close code from the 'close' event. */
  readonly closeCode?: number;
  /** Error from the 'error' event. */
  readonly error?: Error & { code?: string };
  /** True when the disconnect was operator-initiated (our `stop()`). */
  readonly intentional?: boolean;
}

/**
 * Classify a disconnect into one of the documented categories.
 * Precedence:
 *
 *   1. `intentional: true` always wins — we don't mis-tag a
 *      user-driven shutdown as a network problem.
 *   2. Error.code from the 'error' event (Node-side network
 *      error codes are the most reliable signal).
 *   3. Error.message inspection for known WS-library strings
 *      (e.g. "Unexpected server response: 401").
 *   4. closeCode mapping per RFC 6455.
 *   5. UNKNOWN.
 */
export const categorizeDisconnect = (
  input: CategorizeInput
): DisconnectCategory => {
  if (input.intentional === true) return 'INTENTIONAL';

  const error = input.error;
  const code = error?.code;
  if (code !== undefined) {
    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN') {
      return 'NETWORK_DOWN';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return 'DNS_FAILURE';
    }
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return 'SERVER_UNREACHABLE';
    }
    if (
      code.startsWith('ERR_TLS_') ||
      code === 'ERR_SSL_PROTOCOL_ERROR' ||
      code === 'CERT_HAS_EXPIRED' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    ) {
      return 'TLS_HANDSHAKE_FAIL';
    }
  }

  const message = error?.message ?? '';
  if (message.includes('Unexpected server response:')) {
    // The ws library's signature for any non-101 upgrade
    // response — the actual status sits in the message.
    const statusMatch = message.match(/Unexpected server response:\s*(\d+)/);
    if (statusMatch !== null) {
      const status = Number(statusMatch[1]);
      if (status >= 400 && status < 500) return 'SERVER_REJECTED';
      if (status >= 500) return 'SERVER_UNREACHABLE';
    }
    return 'SERVER_REJECTED';
  }
  if (message.toLowerCase().includes('timeout')) {
    return 'CLIENT_TIMEOUT';
  }

  const cc = input.closeCode;
  if (cc !== undefined) {
    // RFC 6455 close codes:
    //   1000 normal closure
    //   1001 going away (server reload / browser navigate)
    //   1002 protocol error
    //   1003 unsupported data
    //   1006 abnormal closure (no Close frame)
    //   1007 invalid frame payload
    //   1008 policy violation
    //   1009 message too big
    //   1011 internal server error
    //   1012 service restart
    //   1013 try again later
    //   1014 bad gateway
    //   1015 TLS handshake failure
    //   4xxx custom (api uses 4001 unauth, 4002 hello-invalid, ...)
    if (cc === 1000 || cc === 1001) return 'INTENTIONAL';
    if (cc === 1002 || cc === 1003 || cc === 1007 || cc === 1008) {
      return 'PROTOCOL_ERROR';
    }
    if (cc === 1006 || cc === 1011 || cc === 1012 || cc === 1013 || cc === 1014) {
      return 'SERVER_UNREACHABLE';
    }
    if (cc === 1015) return 'TLS_HANDSHAKE_FAIL';
    if (cc >= 4000 && cc < 5000) {
      // Our api's 4xxx codes are protocol-level rejections.
      // 4001 specifically is unauthorized — but the WS path
      // handles that separately via the FatalAuthHandler;
      // here we still tag it PROTOCOL_ERROR for the ops
      // dashboard category.
      return 'PROTOCOL_ERROR';
    }
  }

  return 'UNKNOWN';
};
