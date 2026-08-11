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
    conditions.push(Prisma.sql`level = ${level}::"LogLevel"`);
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

function bucketExpression(bucket: string, column: Prisma.Sql): Prisma.Sql {
  const bucketSqlMap: Record<string, Prisma.Sql> = {
    "1m": Prisma.sql`date_trunc('minute', ${column})`,
    "5m": Prisma.sql`date_trunc('hour', ${column}) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM ${column}) / 5)`,
    "1h": Prisma.sql`date_trunc('hour', ${column})`,
    "1d": Prisma.sql`date_trunc('day', ${column})`,
  };

  return bucketSqlMap[bucket]!;
}

function groupClauses(groupBy: string | undefined): {
  select: Prisma.Sql;
  directGroupBy: Prisma.Sql;
  rollupGroupBy: Prisma.Sql;
} {
  if (groupBy === "service") {
    return {
      select: Prisma.sql`service`,
      directGroupBy: Prisma.sql`GROUP BY bucket, service`,
      rollupGroupBy: Prisma.sql`GROUP BY bucket, service`,
    };
  }

  if (groupBy === "level") {
    return {
      select: Prisma.sql`level::text`,
      directGroupBy: Prisma.sql`GROUP BY bucket, level`,
      rollupGroupBy: Prisma.sql`GROUP BY bucket, level`,
    };
  }

  return {
    select: Prisma.sql`NULL::text`,
    directGroupBy: Prisma.sql`GROUP BY bucket`,
    rollupGroupBy: Prisma.sql`GROUP BY bucket`,
  };
}

function ceilToMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}

function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

export function buildRollupAggregateQuery(
  options: AggregateOptions,
): Prisma.Sql | null {
  const { since, until, bucket, groupBy, service, level, q, attrFilters } =
    options;

  if (q || Object.keys(attrFilters).length > 0) return null;

  const rollupStart = ceilToMinute(since);
  const rollupEnd = floorToMinute(until);

  if (rollupStart >= rollupEnd) return null;

  const directFilters: Prisma.Sql[] = [];
  const rollupFilters: Prisma.Sql[] = [
    Prisma.sql`"bucket" >= ${rollupStart}`,
    Prisma.sql`"bucket" < ${rollupEnd}`,
  ];

  if (service) {
    directFilters.push(Prisma.sql`service = ${service}`);
    rollupFilters.push(Prisma.sql`service = ${service}`);
  }

  if (level) {
    directFilters.push(Prisma.sql`level = ${level}::"LogLevel"`);
    rollupFilters.push(Prisma.sql`level = ${level}::"LogLevel"`);
  }

  const boundaryRanges: Prisma.Sql[] = [];
  if (since < rollupStart) {
    boundaryRanges.push(
      Prisma.sql`(timestamp >= ${since} AND timestamp < ${rollupStart})`,
    );
  }
  if (rollupEnd < until) {
    boundaryRanges.push(
      Prisma.sql`(timestamp >= ${rollupEnd} AND timestamp < ${until})`,
    );
  }

  directFilters.push(
    boundaryRanges.length > 0
      ? Prisma.sql`(${Prisma.join(boundaryRanges, " OR ")})`
      : Prisma.sql`FALSE`,
  );

  const directWhere = Prisma.sql`WHERE ${Prisma.join(directFilters, " AND ")}`;
  const rollupWhere = Prisma.sql`WHERE ${Prisma.join(rollupFilters, " AND ")}`;
  const { select, directGroupBy, rollupGroupBy } = groupClauses(groupBy);
  const directBucket = bucketExpression(bucket, Prisma.sql`timestamp`);
  const rollupBucket = bucketExpression(bucket, Prisma.sql`"bucket"`);

  const directRows = Prisma.sql`
    SELECT
      ${directBucket} AS bucket,
      ${select} AS "group",
      COUNT(*)::bigint AS count
    FROM "Log"
    ${directWhere}
    ${directGroupBy}
  `;
  const rollupRows = Prisma.sql`
    SELECT
      ${rollupBucket} AS bucket,
      ${select} AS "group",
      SUM("count")::bigint AS count
    FROM "LogRollup"
    ${rollupWhere}
    ${rollupGroupBy}
  `;

  return Prisma.sql`
    SELECT bucket, "group", SUM(count)::bigint AS count
    FROM (${directRows} UNION ALL ${rollupRows}) AS aggregate_source
    GROUP BY bucket, "group"
    ORDER BY bucket ASC
  `;
}
