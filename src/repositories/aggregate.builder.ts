import { Prisma } from "@prisma/client";
import type { AggregateOptions } from "../types/log.types.js";

type AggregateRow = {
  bucket: Date;
  group: string | null;
  count: bigint;
};

export type AggregateResult = {
  start: string;
  group: string | null;
  count: number;
};

export function buildAggregateQuery(options: AggregateOptions): Prisma.Sql {
  const { since, until, bucket, groupBy, service, level, q, attrFilters } =
    options;

  const bucketSqlMap: Record<string, Prisma.Sql> = {
    "1m": Prisma.sql`date_trunc('minute', timestamp)`,
    "5m": Prisma.sql`date_trunc('hour', timestamp) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM timestamp) / 5)`,
    "1h": Prisma.sql`date_trunc('hour', timestamp)`,
    "1d": Prisma.sql`date_trunc('day', timestamp)`,
  };
  const bucketExpr = bucketSqlMap[bucket]!;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`timestamp >= ${since}`,
    Prisma.sql`timestamp < ${until}`,
  ];

  if (service) {
    conditions.push(Prisma.sql`service = ${service}`);
  }

  if (level) {
    conditions.push(Prisma.sql`level::text = ${level}`);
  }

  if (q) {
    conditions.push(
      Prisma.sql`LOWER(message) LIKE ${"%" + q.toLowerCase() + "%"}`,
    );
  }

  for (const [key, value] of Object.entries(attrFilters)) {
    conditions.push(Prisma.sql`attributes->>${key} = ${value}`);
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

  let groupSelect: Prisma.Sql;
  let groupByClause: Prisma.Sql;

  if (groupBy === "service") {
    groupSelect = Prisma.sql`service`;
    groupByClause = Prisma.sql`GROUP BY bucket, service`;
  } else if (groupBy === "level") {
    groupSelect = Prisma.sql`level::text`;
    groupByClause = Prisma.sql`GROUP BY bucket, level`;
  } else {
    groupSelect = Prisma.sql`NULL::text`;
    groupByClause = Prisma.sql`GROUP BY bucket`;
  }

  return Prisma.sql`
    SELECT
      ${bucketExpr} AS bucket,
      ${groupSelect}                     AS "group",
      COUNT(*)::bigint                   AS count
    FROM "Log"
    ${whereClause}
    ${groupByClause}
    ORDER BY bucket ASC
  `;
}

export function mapAggregateRows(rows: AggregateRow[]): AggregateResult[] {
  return rows.map((row) => ({
    start: row.bucket.toISOString(),
    group: row.group ?? null,
    count: Number(row.count),
  }));
}
