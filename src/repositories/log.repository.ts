import { Prisma, type Log } from "@prisma/client";
import prisma, { pool } from "../database/prisma.js";
import {
  buildAggregateQuery,
  buildRollupAggregateQuery,
  mapAggregateRows,
} from "./aggregate.builder.js";
import { attributeFilter } from "./attribute-filter.js";
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
      `INSERT INTO "Log" ("id", "timestamp", "level", "service", "message", "attributes", "createdAt")
       SELECT
         (
           '00000000-0000-7000-8000-' ||
           lpad(to_hex(nextval('"Log_id_seq"')), 12, '0')
         )::uuid,
         timestamp::timestamptz,
         level::"LogLevel",
         service,
         message,
         COALESCE(attributes, '{}'::jsonb),
         NOW()
       FROM jsonb_to_recordset($1::jsonb) AS input(
         timestamp text,
         level text,
         service text,
         message text,
         attributes jsonb
       )`,
      [JSON.stringify(logs)],
    );
    return { count: logs.length };
  }

  async findMany(options: LogQueryOptions, take: number): Promise<Log[]> {
    const conditions: Prisma.Sql[] = [];

    if (options.service) {
      conditions.push(Prisma.sql`service = ${options.service}`);
    }

    if (options.level) {
      conditions.push(Prisma.sql`level = ${options.level}::"LogLevel"`);
    }

    if (options.since) {
      conditions.push(Prisma.sql`timestamp >= ${options.since}`);
    }

    if (options.until) {
      conditions.push(Prisma.sql`timestamp < ${options.until}`);
    }

    for (const [key, value] of Object.entries(options.attrFilters)) {
      conditions.push(attributeFilter(key, value));
    }

    if (options.q) {
      conditions.push(
        Prisma.sql`LOWER(message) LIKE ${`%${options.q.toLowerCase()}%`}`,
      );
    }

    if (options.cursor) {
      const cursorTimestamp = new Date(options.cursor.timestamp);
      conditions.push(Prisma.sql`
        (timestamp < ${cursorTimestamp}
          OR (timestamp = ${cursorTimestamp} AND id < ${options.cursor.id}::uuid))
      `);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const query = Prisma.sql`
      SELECT id, timestamp, level, service, message, attributes, "createdAt"
      FROM "Log"
      ${whereClause}
      ORDER BY timestamp DESC, id DESC
      LIMIT ${take}
    `;

    return prisma.$queryRaw<Log[]>(query);
  }

  async aggregate(options: AggregateOptions) {
    const sql =
      buildRollupAggregateQuery(options) ?? buildAggregateQuery(options);
    const rows =
      await prisma.$queryRaw<
        { bucket: Date; group: string | null; count: bigint }[]
      >(sql);
    return mapAggregateRows(rows);
  }
}

export default new LogRepository();
