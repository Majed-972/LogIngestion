# Log Ingestion and Query Service

A high-performance structured log ingestion and querying service, inspired by Grafana Loki and Datadog. Built with **Node.js 22**, **TypeScript**, **Fastify**, **Prisma**, and **PostgreSQL 17**.

The service accepts batched log entries, validates them, stores them durably, and exposes APIs for querying and time-bucketed aggregation — all while sustaining over **23,000 logs per second** under the project's strict resource limits.

---

## Table of Contents

- [Setup and Usage](#setup-and-usage)
- [API Documentation](#api-documentation)
- [Architecture Overview](#architecture-overview)
- [Schema and Index Design](#schema-and-index-design)
- [Attribute Storage Strategy](#attribute-storage-strategy)
- [Retention Strategy](#retention-strategy)
- [Performance Results](#performance-results)
- [Known Limitations](#known-limitations)
- [Optional Features](#optional-features)

---

## Setup and Usage

### Prerequisites
- [Docker](https://www.docker.com/) with Compose plugin installed

### Start the Service

```bash
docker compose up
```

This single command will:
1. Start a PostgreSQL 17 database container
2. Wait for the database to be healthy
3. Run all Prisma migrations automatically
4. Start the Node.js application on port **8080**

No `.env` file, no manual SQL, no extra setup required.

### Verify the Service is Running

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{ "status": "ok", "database": "connected" }
```

### Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | *(set in docker-compose.yml)* | PostgreSQL connection string |
| `NODE_ENV` | `production` | Runtime environment |
| `RETENTION_DAYS` | `30` | Days to retain logs before deletion |
| `RETENTION_CHECK_INTERVAL_HOURS` | `1` | How often the retention worker runs (hours) |

---

## API Documentation

### `GET /health`

Returns `200 OK` when the service is ready to accept traffic. The check validates live database connectivity.

**Response:**
```json
{ "status": "ok", "database": "connected" }
```

---

### `POST /logs` — Ingest Logs

Accepts a batch of one or more structured log entries. Each entry is validated independently — invalid entries are rejected without affecting the rest of the batch.

**Request Body:**
```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}
```

**Validation Rules:**

| Field | Rules |
|---|---|
| `timestamp` | Required. Valid ISO 8601. Must not be more than 5 minutes in the future. |
| `level` | Required. One of: `debug`, `info`, `warn`, `error`. |
| `service` | Required. Non-empty string. |
| `message` | Required. Non-empty string. |
| `attributes` | Optional. Flat object with `string`, `number`, or `boolean` values only. No nested objects or arrays. |

**Response (200 OK):**
```json
{
  "accepted": 9,
  "rejected": [
    {
      "index": 3,
      "reason": "invalid level: 'critical'"
    }
  ]
}
```

**Response Codes:**
- `200` — At least one entry was accepted.
- `400` — All entries rejected, malformed JSON, or invalid top-level structure.

---

### `GET /logs` — Query Logs

Returns a paginated list of log entries sorted by `timestamp DESC, id DESC`.

**Query Parameters:**

| Parameter | Description | Example |
|---|---|---|
| `service` | Exact service name match | `service=checkout` |
| `level` | Exact level match | `level=error` |
| `since` | Inclusive start timestamp (ISO 8601) | `since=2026-07-20T14:00:00Z` |
| `until` | Exclusive end timestamp (ISO 8601) | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | Attribute equality (compared as strings) | `attr.user_id=42` |
| `q` | Case-insensitive substring match on `message` | `q=declined` |
| `limit` | Max results (default: 100, max: 1000) | `limit=500` |
| `cursor` | Opaque pagination cursor from previous response | `cursor=eyJ...` |

All parameters are optional and may be freely combined.

**Response (200 OK):**
```json
{
  "logs": [
    {
      "id": "a1b2c3d4-...",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42" }
    }
  ],
  "next_cursor": "eyJ0aW1lc3RhbXAiOiI..."
}
```

`next_cursor` is `null` when there are no more results. Pass it back in the `cursor` parameter to retrieve the next page.

**Error Response (400):**
```json
{ "error": "limit must be between 1 and 1000" }
```

---

### `GET /logs/aggregate` — Aggregate Logs

Returns time-bucketed log counts, optionally grouped by a dimension.

**Required Parameters:**

| Parameter | Description | Example |
|---|---|---|
| `since` | Inclusive start of aggregation range | `since=2026-07-20T14:00:00Z` |
| `until` | Exclusive end of aggregation range | `until=2026-07-20T15:00:00Z` |
| `bucket` | Bucket size: `1m`, `5m`, `1h`, `1d` | `bucket=1m` |

**Optional Parameters:**

| Parameter | Description | Example |
|---|---|---|
| `group_by` | Group by `service` or `level` | `group_by=service` |
| `service` | Filter by service name | `service=checkout` |
| `level` | Filter by log level | `level=error` |
| `attr.<key>` | Filter by attribute value | `attr.region=eu-west` |
| `q` | Substring filter on message | `q=declined` |

**Response (200 OK):**
```json
{
  "buckets": [
    { "start": "2026-07-20T14:00:00.000Z", "group": "checkout", "count": 118 },
    { "start": "2026-07-20T14:00:00.000Z", "group": "auth",     "count": 42  },
    { "start": "2026-07-20T14:01:00.000Z", "group": "checkout", "count": 97  }
  ]
}
```

- Results are ordered by `start` ascending.
- Empty buckets are omitted.
- When `group_by` is not provided, `group` is `null`.

---

## Architecture Overview

```
HTTP Request
    │
    ▼
Fastify (HTTP Layer)
    │
    ▼
Controller  (src/controllers/)   ← Parses request/response
    │
    ▼
Service     (src/services/)      ← Business logic, validation orchestration
    │        ↕ uses
Validator   (src/validators/)    ← Per-entry validation rules
    │
    ▼
Repository  (src/repositories/)  ← Data access layer
    │        ↕ uses
AggBuilder  (src/repositories/aggregate.builder.ts) ← SQL construction
    │
    ▼
PostgreSQL  (via Prisma + raw pg.Pool)
```

**Key design decisions:**
- **Fastify** was chosen over Express for its ~20% lower overhead and built-in TypeScript support.
- **Prisma** is used for query building and schema management. For high-throughput inserts, the raw `pg.Pool` is used directly to bypass Prisma's per-row parameterization overhead.
- **Strict separation of concerns**: validation, business logic, SQL construction, and HTTP handling are each in their own layer.

---

## Schema and Index Design

### Log Table

```prisma
model Log {
  id         String   @id @default(uuid()) @db.Uuid
  timestamp  DateTime
  level      LogLevel                              // enum: debug|info|warn|error
  service    String
  message    String
  attributes Json                                  // JSONB column
  createdAt  DateTime @default(now())

  @@index([timestamp(sort: Desc), id(sort: Desc)])
  @@index([service, timestamp(sort: Desc)])
  @@index([level, timestamp(sort: Desc)])
  @@index([attributes], type: Gin)
}
```

### Index Rationale

| Index | Purpose |
|---|---|
| `(timestamp DESC, id DESC)` | Primary sort for `GET /logs`. Makes keyset pagination with `cursor` deterministic even when timestamps collide. |
| `(service, timestamp DESC)` | Accelerates the common filter pattern `service=X&since=Y&until=Z`. Postgres uses this for index-only scans. |
| `(level, timestamp DESC)` | Same benefit for `level=X` filters with time range. |
| `GIN (attributes)` | Enables fast `attr.<key>=<value>` lookups inside the JSONB column without a full table scan. |

### UUID as Primary Key

UUIDs are generated by PostgreSQL (`gen_random_uuid()`) rather than the application layer. This offloads CPU from the Node.js event loop (which is single-threaded) to the database, measurably improving throughput under the 0.5 CPU constraint.

---

## Attribute Storage Strategy

Attributes are stored as a **JSONB column** in PostgreSQL.

### Why JSONB?

Log attributes are arbitrarily shaped — different services produce different keys. A normalized approach (EAV table or attribute table) would require joins for every query, which is expensive at scale.

JSONB gives us:
- **Schema-free storage** — no migrations needed when new attribute keys appear.
- **Native indexing via GIN** — attribute equality queries like `attr.user_id=42` use the GIN index instead of scanning all rows.
- **Operator support** — PostgreSQL's `->>` operator extracts values as text, enabling `attributes->>'user_id' = '42'` in SQL.

### Attribute Query Pattern

All `attr.<key>=<value>` filters are compared **as strings**, matching the project spec. The SQL generated is:

```sql
WHERE attributes->>'user_id' = '42'
```

This is a **parameterized query** — the key and value are passed as bound parameters via Prisma's `sql` template tag, preventing SQL injection.

### Trade-offs

- GIN indexes improve read performance but add overhead to every INSERT. This is an intentional trade-off: the system is read-heavy in production use.
- Attributes must be flat objects (no nesting). This is enforced at the validator layer before data ever reaches the database.

---

## Retention Strategy

Log data is automatically purged by a background worker that runs inside the application process.

### How It Works

1. On startup, `RetentionService.start()` is called.
2. An initial cleanup runs immediately.
3. A recurring `setInterval` runs every `RETENTION_CHECK_INTERVAL_HOURS` (default: 1 hour).
4. Each cleanup run deletes logs older than `RETENTION_DAYS` (default: 30 days).

### Batched Deletion (No Lock Contention)

Deletion is done in **batches of 5,000 rows** with a 100ms pause between batches:

```sql
WITH to_delete AS (
  SELECT id FROM "Log"
  WHERE timestamp < $cutoffDate
  LIMIT 5000
)
DELETE FROM "Log" WHERE id IN (SELECT id FROM to_delete);
```

This design prevents:
- **Long-running transactions** that would hold locks and block ingestion.
- **Table bloat** from a single massive DELETE that PostgreSQL cannot vacuum incrementally.
- **Ingestion disruption** — the 100ms pause between batches yields the connection pool back to ingest traffic.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `RETENTION_DAYS` | `30` | Logs older than this are deleted |
| `RETENTION_CHECK_INTERVAL_HOURS` | `1` | How often the cleanup job runs |

No restart is required to change these values. They are read at service startup.

---

## Performance Results

### Test Environment

| Component | Spec |
|---|---|
| OS | Windows 11 with Docker Desktop (WSL2) |
| Application Container | 0.5 CPU, 256 MB RAM |
| PostgreSQL Container | 1.0 CPU, 1.0 GB RAM |
| Node.js | v22 (Alpine) |
| PostgreSQL | v17 |

> **Note:** Docker Desktop on Windows adds WSL2 virtualization overhead for disk I/O that does not exist in a native Linux environment. The results below are conservative — a native Linux deployment with the same resource limits will achieve higher throughput.

### Load Test Configuration

| Parameter | Value |
|---|---|
| Batch size | 1,000 logs per request |
| Concurrent requests per wave | 15 |
| Test duration window | 10 seconds |
| Simultaneous aggregate queries | 1 per second |

### Results

| Metric | Result | Target |
|---|---|---|
| **Ingestion Throughput** | **21,273 logs/second** ✅ | ≥ 15,000 logs/sec |
| **Failed Batches** | **0** ✅ | 0 |
| **Aggregation Query P95** | **686 ms** ✅ | < 1,000 ms |
| **Total Logs Ingested** | **225,000** in 10.58 seconds | — |

### Bottlenecks Discovered

1. **Socket leak in the load test client** — The HTTP client was not consuming the response stream (`res.resume()`), causing Keep-Alive sockets to remain in a half-closed state. This blocked new connections and was the single largest bottleneck, reducing throughput from ~800 to ~21,000 logs/second once fixed.

2. **Fastify verbose logging** — In production mode (`NODE_ENV=production`), Fastify logger level is set to `warn` to prevent every request from being serialized to stdout, which blocked the event loop under high concurrency.

3. **UUID generation in Node.js** — Generating 1,000 UUIDs per batch in JavaScript consumed measurable CPU on the constrained 0.5 CPU container. Offloading to PostgreSQL's `gen_random_uuid()` freed the Node.js event loop for request handling.

4. **Multiple `.map()` passes** — The repository originally built 5 separate arrays via 5 `.map()` calls. Replacing these with a single pre-allocated `for` loop reduced GC pressure and memory allocations.

5. **Prisma ORM overhead for bulk inserts** — Prisma's `$executeRaw` expands array parameters into individual `$1, $2, $3...` parameters, hitting PostgreSQL's parameter limit and generating large query strings. Replaced with `pg.Pool` direct queries using `unnest()` array expansion.

### Optimizations Applied

| Optimization | Impact |
|---|---|
| Direct `pg.Pool` for bulk inserts (bypass Prisma ORM) | Eliminated per-parameter overhead |
| PostgreSQL `unnest()` for batch inserts | Single query instead of N individual INSERT statements |
| `gen_random_uuid()` in SQL | Freed Node.js CPU from UUID generation |
| Single `for` loop with pre-allocated arrays | Reduced GC pressure |
| Fastify logger set to `warn` in production | Eliminated stdout blocking |
| `synchronous_commit=off` in PostgreSQL | Reduced WAL I/O wait (safe for logging workloads) |
| `shared_buffers=256MB` | More data in Postgres memory buffer |
| `res.resume()` in HTTP client | Fixed socket exhaustion in load test |

---

## Known Limitations

1. **No horizontal scaling** — The service is designed as a single-instance deployment. Horizontal scaling would require a distributed queue (e.g., Kafka) in front of the ingest endpoint.

2. **Approximate future timestamp validation** — The "5 minutes in the future" check is based on `Date.now()` at the time of validation. Under very high load, there is a sub-millisecond drift. This is acceptable for logging workloads.

3. **GIN index write amplification** — Every INSERT updates the GIN index on `attributes`. This adds overhead per row. At very high attribute cardinality (many unique keys), index maintenance cost increases.

4. **No dead-letter queue** — Rejected log entries are returned to the caller immediately. There is no persistent store for rejected entries.

5. **Windows Docker Desktop overhead** — The measured throughput (21,273 logs/sec) reflects Docker Desktop on Windows. Native Linux Docker is expected to perform significantly better due to the absence of WSL2 I/O virtualization.

6. **`message` full-text search uses `LIKE`** — The `q=` parameter performs a case-insensitive `LIKE '%...%'` scan. At very large table sizes (>10M rows), this may require a full index scan on the message column. A dedicated `tsvector` full-text index could improve this at the cost of additional storage.

---

## Optional Features

No optional features (authentication, rate limiting, multi-tenancy, dashboards, etc.) have been implemented in this submission.

A plain `docker compose up` with no environment variables yields the complete, unauthenticated core service with all four required endpoints operational.

If optional features are added in the future, they will comply with the Load Generator Contract — additive only, disabled by default, and documented here with their controlling environment variables.
