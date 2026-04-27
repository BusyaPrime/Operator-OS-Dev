import type { FastifyBaseLogger } from 'fastify';

import type {
  AgentAuditWriter,
  AgentAuthEvent
} from './agent-token-guard.js';

/**
 * Phase 4.0 Part 3.H — audit pipeline stub.
 *
 * `LoggingAuditWriter` is the default implementation wired
 * into `buildServer`: every audit event lands as a structured
 * pino log line at INFO level under
 * `{ source: 'agent-audit', eventType: ..., agentId: ..., ... }`.
 * Operations can grep these lines from Cloud Logging while the
 * real BigQuery pipeline (TD-057) is being provisioned.
 *
 * Once TD-057 lands, swap the writer behind the
 * `AGENT_AUDIT_BACKEND=bigquery` env switch — the interface
 * stays the same, so nothing in the agentTokenGuard or the
 * route handlers has to change.
 */
export class LoggingAuditWriter implements AgentAuditWriter {
  readonly name = 'logging-audit-writer';
  #logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.#logger = logger.child({ source: 'agent-audit' });
  }

  async record(event: AgentAuthEvent): Promise<void> {
    this.#logger.info(
      {
        eventType: event.eventType,
        agentId: event.agentId,
        userId: event.userId,
        latencyMs: event.latencyMs,
        ip: event.ip,
        userAgent: event.userAgent,
        errorCode: event.errorCode
      },
      'agent audit event'
    );
  }
}

/**
 * Convenience: a recording writer for tests. Captures every
 * event into an in-memory array; integration tests read the
 * array to assert audit emission for the round-trip.
 */
export class RecordingAuditWriter implements AgentAuditWriter {
  readonly name = 'recording-audit-writer';
  readonly events: AgentAuthEvent[] = [];

  async record(event: AgentAuthEvent): Promise<void> {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}
