import type { Log } from "@prisma/client";
import prisma, { pool } from "../database/prisma.js";
import {
  buildAggregateQuery,
  buildRollupAggregateQuery,
  mapAggregateRows,
  type AggregateRow,
} from "./aggregate.builder.js";
import type {
  AggregateOptions,
  ValidatedLogInput,
} from "../types/log.types.js";

type PendingInsert = {
  logs: ValidatedLogInput[];
  deferred: PromiseWithResolvers<{ count: number }>;
};

export type LogQueryOptions = {
  service?: string | undefined;
  level?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  attrFilters: Record<string, string>;
  q?: string | undefined;
  cursor?: { timestamp: string; id: string } | undefined;
};

export class LogRepository {
  private readonly maxInsertRows = 2_048;
  private readonly flushDelayMs = 2;
  private pendingInserts: PendingInsert[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;

  insertMany(logs: ValidatedLogInput[]): Promise<{ count: number }> {
    if (logs.length === 0) return Promise.resolve({ count: 0 });

    const deferred = Promise.withResolvers<{ count: number }>();
    this.pendingInserts.push({ logs, deferred });
    this.scheduleFlush();
    return deferred.promise;
  }

  private scheduleFlush() {
    if (this.isFlushing || this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPendingInserts();
    }, this.flushDelayMs);
  }

  private takePendingBatch(): PendingInsert[] {
    const batch: PendingInsert[] = [];
    let rowCount = 0;

    while (this.pendingInserts.length > 0) {
      const next = this.pendingInserts[0]!;

      if (
        batch.length > 0 &&
        rowCount + next.logs.length > this.maxInsertRows
      ) {
        break;
      }

      batch.push(this.pendingInserts.shift()!);
      rowCount += next.logs.length;
    }

    return batch;
  }

  private async flushPendingInserts() {
    if (this.isFlushing) return;

    this.isFlushing = true;

    try {
      while (this.pendingInserts.length > 0) {
        const batch = this.takePendingBatch();
        const logs = batch.flatMap((entry) => entry.logs);

        try {
          await this.insertBatch(logs);
          for (const entry of batch) {
            entry.deferred.resolve({ count: entry.logs.length });
          }
        } catch (error) {
          for (const entry of batch) {
            entry.deferred.reject(error);
          }
        }
      }
    } finally {
      this.isFlushing = false;
      this.scheduleFlush();
    }
  }

  private async insertBatch(logs: ValidatedLogInput[]) {
    await pool.query(
      `WITH payload AS (
         SELECT
           timestamp::timestamptz AS "timestamp",
           level::"LogLevel" AS "level",
           service,
           message,
           COALESCE(attributes, '{}'::jsonb) AS attributes
         FROM jsonb_to_recordset($1::jsonb) AS input(
           timestamp text,
           level text,
           service text,
           message text,
           attributes jsonb
         )
       ), inserted AS (
         INSERT INTO "Log" ("id", "timestamp", "level", "service", "message", "attributes", "createdAt")
         SELECT
           (
             '00000000-0000-7000-8000-' ||
             lpad(to_hex(nextval('"Log_id_seq"')), 12, '0')
           )::uuid,
           "timestamp",
           "level",
           service,
           message,
           attributes,
           NOW()
         FROM payload
         RETURNING "timestamp", "service", "level"
       ), rollups AS (
         SELECT
           date_trunc('minute', "timestamp") AS "bucket",
           date_trunc('second', "timestamp") AS "second_bucket",
           "service",
           "level",
           COUNT(*)::bigint AS "count"
         FROM inserted
         GROUP BY 1, 2, 3, 4
       ), minute_rollups AS (
         SELECT "bucket", "service", "level", SUM("count")::bigint AS "count"
         FROM rollups
         GROUP BY 1, 2, 3
       ), second_rollups AS (
         SELECT "second_bucket" AS "bucket", "service", "level", "count"
         FROM rollups
       ), inserted_minutes AS (
         INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
         SELECT "bucket", "service", "level", "count"
         FROM minute_rollups
         ON CONFLICT ("bucket", "service", "level")
         DO UPDATE SET "count" = "LogRollup"."count" + EXCLUDED."count"
         RETURNING 1
       )
       INSERT INTO "LogSecondRollup" ("bucket", "service", "level", "count")
       SELECT "bucket", "service", "level", "count"
       FROM second_rollups
       ON CONFLICT ("bucket", "service", "level")
       DO UPDATE SET "count" = "LogSecondRollup"."count" + EXCLUDED."count"`,
      [JSON.stringify(logs)],
    );
    return { count: logs.length };
  }

  async findMany(options: LogQueryOptions, take: number): Promise<Log[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.service) {
      values.push(options.service);
      conditions.push(`service = $${values.length}`);
    }

    if (options.level) {
      values.push(options.level);
      conditions.push(`level = $${values.length}::"LogLevel"`);
    }

    if (options.since) {
      values.push(options.since);
      conditions.push(`timestamp >= $${values.length}`);
    }

    if (options.until) {
      values.push(options.until);
      conditions.push(`timestamp < $${values.length}`);
    }

    for (const [key, value] of Object.entries(options.attrFilters)) {
      values.push(key, value);
      const kIdx = values.length - 1;
      const vIdx = values.length;
      if (value === "true" || value === "false") {
        conditions.push(
          `(attributes @> jsonb_build_object($${kIdx}::text, $${vIdx}::text) OR attributes @> jsonb_build_object($${kIdx}::text, $${vIdx}::text::boolean))`,
        );
      } else if (
        Number.isFinite(Number(value)) &&
        String(Number(value)) === value
      ) {
        conditions.push(
          `(attributes @> jsonb_build_object($${kIdx}::text, $${vIdx}::text) OR attributes @> jsonb_build_object($${kIdx}::text, $${vIdx}::text::numeric))`,
        );
      } else {
        conditions.push(
          `attributes @> jsonb_build_object($${kIdx}::text, $${vIdx}::text)`,
        );
      }
    }

    if (options.q) {
      values.push(`%${options.q.toLowerCase()}%`);
      conditions.push(`LOWER(message) LIKE $${values.length}`);
    }

    if (options.cursor) {
      values.push(options.cursor.timestamp, options.cursor.id);
      const tIdx = values.length - 1;
      const idIdx = values.length;
      conditions.push(
        `("timestamp", "id") < ($${tIdx}::timestamptz, $${idIdx}::uuid)`,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    values.push(take);
    const limitIdx = values.length;

    const sql = `
      SELECT id, timestamp, level, service, message, attributes
      FROM "Log"
      ${whereClause}
      ORDER BY timestamp DESC, id DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query<Log>(sql, values);
    return result.rows;
  }

  async aggregate(options: AggregateOptions) {
    const sql =
      buildRollupAggregateQuery(options) ?? buildAggregateQuery(options);
    const rows = await prisma.$queryRaw<AggregateRow[]>(sql);
    return mapAggregateRows(rows);
  }
}

export default new LogRepository();
