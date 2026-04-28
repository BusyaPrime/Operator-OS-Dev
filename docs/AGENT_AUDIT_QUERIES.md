# Agent Auth Audit — Forensic Query Catalogue

Phase 4.0 TD-057 closure artifact. Companion to ADR-025 D1.

The agent auth audit trail lives in BigQuery at:

```
operator-os-dev.operator_os_dev_audit.agent_auth
```

- **Region:** `EU` (multi-region; matches the api home region `europe-west4`).
- **Schema:** `infra/bigquery/agent_auth.schema.json`.
- **Partitioned:** daily on `timestamp`.
- **Clustered:** on `(agent_id, event_type)` so the common
  filter shapes (per-agent forensics, anomaly drilldowns)
  read minimal bytes.
- **Partition expiration:** 365 days (`time_partitioning_expiration=31536000`).

The api streams every `AgentAuthEvent` through
`BigQueryAuditWriter` (`apps/api/src/integrations/audit/bigquery-audit-writer.ts`)
behind a 50 ms timeout. Failures and timeouts degrade to a
single `pino warn` line under `source=agent-audit`; the auth
hot path NEVER blocks on BQ.

## Reproducing the schema from scratch

If the table is dropped or migrated to a new project, the
provisioning is reproducible from the schema JSON:

```bash
bq mk --location=eu \
  --description="Phase 4.0 agent auth audit trail per ADR-025 D1 (TD-057)" \
  --dataset operator-os-dev:operator_os_dev_audit

bq mk --table \
  --time_partitioning_field=timestamp \
  --time_partitioning_type=DAY \
  --time_partitioning_expiration=31536000 \
  --clustering_fields=agent_id,event_type \
  --description="Phase 4.0 agent auth audit trail per ADR-025 D1 (TD-057)" \
  operator-os-dev:operator_os_dev_audit.agent_auth \
  ./infra/bigquery/agent_auth.schema.json
```

Dataset-scoped IAM grant (modern `roles/bigquery.dataEditor`
binding is allowlist-blocked on this project, so we go
through the legacy ACL — semantically identical):

```bash
cat > /tmp/operator_os_dev_audit_acl.json <<'EOF'
{
  "access": [
    {"role": "WRITER", "specialGroup": "projectWriters"},
    {"role": "OWNER", "specialGroup": "projectOwners"},
    {"role": "OWNER", "userByEmail": "xodarevakmal@gmail.com"},
    {"role": "READER", "specialGroup": "projectReaders"},
    {"role": "roles/bigquery.dataEditor",
     "iamMember": "serviceAccount:cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com"}
  ]
}
EOF
bq update --source /tmp/operator_os_dev_audit_acl.json operator-os-dev:operator_os_dev_audit
```

## Verification queries

These are the queries to run against the deployed api after
the curl-driven register/rotate/revoke smoke from R23.

### 1. Smoke — last hour of events

Confirms the writer is producing rows and the schema matches.

```sql
SELECT
  timestamp,
  agent_id,
  user_id,
  event_type,
  success,
  latency_ms,
  ip,
  user_agent,
  error_code
FROM `operator-os-dev.operator_os_dev_audit.agent_auth`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY timestamp DESC
LIMIT 50;
```

### 2. Schema sanity — column types match the JSON

```sql
SELECT column_name, data_type, is_nullable
FROM `operator-os-dev.operator_os_dev_audit.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'agent_auth'
ORDER BY ordinal_position;
```

Expected: `timestamp` REQUIRED TIMESTAMP, `agent_id`/`user_id`
NULLABLE STRING, `event_type` REQUIRED STRING, `ip`/`user_agent`
NULLABLE STRING, `success` REQUIRED BOOL, `latency_ms`
NULLABLE INT64, `error_code` NULLABLE STRING, `metadata`
NULLABLE JSON.

### 3. Forensics — failed-auth events for a specific agent

Useful for "did agent X get any 401s in the last 24h?".

```sql
SELECT
  timestamp,
  event_type,
  ip,
  user_agent,
  error_code,
  latency_ms
FROM `operator-os-dev.operator_os_dev_audit.agent_auth`
WHERE agent_id = @agent_id
  AND success = FALSE
  AND timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
ORDER BY timestamp DESC;
```

### 4. Anomaly — auth_failed_unknown_token spike (geo-jump / phishing)

Counts unknown-token attempts per (ip, hour) — a tight
spike from a single IP hitting many agents = credential
spray indicator.

```sql
SELECT
  TIMESTAMP_TRUNC(timestamp, HOUR) AS hour,
  ip,
  COUNT(*) AS unknown_token_attempts
FROM `operator-os-dev.operator_os_dev_audit.agent_auth`
WHERE event_type = 'auth_failed_unknown_token'
  AND timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY hour, ip
HAVING unknown_token_attempts > 5
ORDER BY hour DESC, unknown_token_attempts DESC;
```

### 5. Latency check — p50/p95/p99 of the auth hot path

Confirms the audit writer's 50 ms budget isn't propagating
into observable auth latency.

```sql
SELECT
  TIMESTAMP_TRUNC(timestamp, HOUR) AS hour,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]  AS p50_ms,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]  AS p95_ms,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(99)]  AS p99_ms,
  COUNT(*) AS events
FROM `operator-os-dev.operator_os_dev_audit.agent_auth`
WHERE event_type IN ('auth_success', 'auth_success_previous_hash')
  AND timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY hour
ORDER BY hour DESC;
```

### 6. Lifecycle — registrations and revocations per day

```sql
SELECT
  DATE(timestamp) AS day,
  COUNTIF(event_type = 'agent_registered') AS registrations,
  COUNTIF(event_type = 'token_rotated')    AS rotations,
  COUNTIF(event_type = 'agent_revoked')    AS revocations
FROM `operator-os-dev.operator_os_dev_audit.agent_auth`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC;
```

## Cost guardrail

Streaming inserts are billed at ~$0.05/GB. At the projected
volume (≈400 bytes/row × ~100k events/day = ~40 MB/day in a
busy production scenario) the daily cost is sub-cent.

Recommended Cloud Monitoring billing alert: trigger when
**BigQuery streaming-insert spend on the `operator_os_dev_audit`
dataset exceeds USD $0.50/day**. That's ~10 GB/day of
inserts — three orders of magnitude above projected volume,
so a hit means either a runaway loop in the writer or an
attack flooding auth attempts. Either way the on-call wants to
know.

The actual alert provisioning is deferred to **TD-060**
(filed in `docs/TECH_DEBT.md`) — at current zero-traffic
state the alert isn't load-bearing and the
`gcloud billing budgets create` flow is heavyweight enough
to deserve its own PR.
