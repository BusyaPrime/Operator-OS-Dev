import { BigQuery } from '@google-cloud/bigquery';
import type { FastifyBaseLogger } from 'fastify';

import type {
  AgentAuditWriter,
  AgentAuthEvent
} from '../agent-token-guard.js';

/**
 * Phase 4.0 TD-057 — BigQuery-backed agent audit writer.
 *
 * Streams every `AgentAuthEvent` into
 * `operator_os_dev_audit.agent_auth` (provisioned by `bq mk`,
 * schema in `infra/bigquery/agent_auth.schema.json`). Fire-and-
 * forget against a 50 ms timeout: a slow or unreachable BigQuery
 * MUST never block the auth hot path. Failures are degraded to
 * a single pino warn — the request continues regardless.
 *
 * Default behaviour matches the ADR-025 D1 forensic-trail
 * requirement (timestamp + event_type + agent_id + ip + ua +
 * success + latency_ms + error_code + metadata).
 */

/**
 * Minimal structural type for the BigQuery `Table.insert` we
 * exercise. Production wires a real `bigquery.Table`; tests
 * pass a fake exposing only this surface.
 */
export interface AuditTable {
  insert(
    rows: ReadonlyArray<Record<string, unknown>>
  ): Promise<unknown>;
}

export interface BigQueryAuditWriterOptions {
  readonly table: AuditTable;
  readonly logger: FastifyBaseLogger;
  /**
   * Hard cap on how long `record()` blocks before resolving
   * regardless of insert state. Default 50 ms — chosen so the
   * audit emit fits inside the auth hot-path budget. The
   * insert continues in the background after the timeout; its
   * failure (if any) lands in the same pino warn channel.
   */
  readonly timeoutMs?: number;
  /** Test seam: deterministic clock for the `timestamp` column. */
  readonly now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 50;

/**
 * Map an `AgentAuthEvent` to the BigQuery row shape declared in
 * `infra/bigquery/agent_auth.schema.json`. `success` is derived
 * from the eventType so the column stays queryable without a
 * CASE expression at read-time. `metadata` is reserved (always
 * null today) so future fields ship without a schema migration.
 */
const mapEventToRow = (
  event: AgentAuthEvent,
  timestamp: Date
): Record<string, unknown> => ({
  timestamp: timestamp.toISOString(),
  agent_id: event.agentId,
  user_id: event.userId,
  event_type: event.eventType,
  ip: event.ip ?? null,
  user_agent: event.userAgent ?? null,
  success: !event.eventType.startsWith('auth_failed_'),
  latency_ms: event.latencyMs,
  error_code: event.errorCode ?? null,
  metadata: null
});

export class BigQueryAuditWriter implements AgentAuditWriter {
  readonly name = 'bigquery-audit-writer';
  #table: AuditTable;
  #logger: FastifyBaseLogger;
  #timeoutMs: number;
  #now: () => Date;

  constructor(options: BigQueryAuditWriterOptions) {
    this.#table = options.table;
    this.#logger = options.logger.child({ source: 'agent-audit' });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
  }

  async record(event: AgentAuthEvent): Promise<void> {
    const row = mapEventToRow(event, this.#now());

    // Detached insert. The .catch() is attached eagerly so a
    // late rejection (after the timeout has already returned
    // control to the caller) does NOT bubble up as an
    // unhandled rejection.
    const insertPromise = this.#table
      .insert([row])
      .then(() => 'ok' as const)
      .catch((err: unknown) => {
        this.#logger.warn(
          {
            err,
            eventType: event.eventType,
            agentId: event.agentId
          },
          'bigquery audit insert failed'
        );
        return 'error' as const;
      });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(
        () => resolve('timeout'),
        this.#timeoutMs
      );
    });

    const winner = await Promise.race([insertPromise, timeoutPromise]);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

    if (winner === 'timeout') {
      this.#logger.warn(
        {
          eventType: event.eventType,
          agentId: event.agentId,
          timeoutMs: this.#timeoutMs
        },
        'bigquery audit insert timed out'
      );
    }
  }
}

export interface CreateBigQueryAuditWriterOptions {
  readonly projectId: string;
  readonly dataset: string;
  readonly table: string;
  readonly logger: FastifyBaseLogger;
  readonly timeoutMs?: number;
}

/**
 * Production factory. Builds a real BigQuery client targeted
 * at `projectId.dataset.table` and hands the resulting Table
 * handle to a `BigQueryAuditWriter`. Kept separate from the
 * class so tests can avoid the real SDK entirely.
 */
export const createBigQueryAuditWriter = (
  options: CreateBigQueryAuditWriterOptions
): BigQueryAuditWriter => {
  const client = new BigQuery({ projectId: options.projectId });
  const table = client.dataset(options.dataset).table(options.table);
  return new BigQueryAuditWriter({
    table: table as unknown as AuditTable,
    logger: options.logger,
    timeoutMs: options.timeoutMs
  });
};
