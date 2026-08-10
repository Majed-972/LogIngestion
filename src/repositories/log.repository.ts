import { Prisma } from "@prisma/client";
import prisma, { pool } from "../database/prisma.js";
import { buildAggregateQuery, mapAggregateRows } from "./aggregate.builder.js";
import type {
  AggregateOptions,
  ValidatedLogInput,
} from "../types/log.types.js";

export class LogRepository {
  async insertMany(logs: ValidatedLogInput[]) {
    if (logs.length === 0) return { count: 0 };

    const len = logs.length;
    const timestamps = new Array(len);
    const levels = new Array(len);
    const services = new Array(len);
    const messages = new Array(len);
    const attributes = new Array(len);

    for (let i = 0; i < len; i++) {
      const l = logs[i]!;
      timestamps[i] = l.timestamp;
      levels[i] = l.level;
      services[i] = l.service;
      messages[i] = l.message;
      attributes[i] = JSON.stringify(l.attributes);
    }

    await pool.query(
      `INSERT INTO "Log" ("id", "timestamp", "level", "service", "message", "attributes", "createdAt")
       SELECT
         gen_random_uuid(),
         unnest($1::timestamptz[]),
         unnest($2::"LogLevel"[]),
         unnest($3::text[]),
         unnest($4::text[]),
         unnest($5::jsonb[]),
         NOW()`,
      [timestamps, levels, services, messages, attributes],
    );
    return { count: logs.length };
  }

  async findMany(where: Prisma.LogWhereInput, take: number) {
    return prisma.log.findMany({
      where,
      take,
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    });
  }

  async aggregate(options: AggregateOptions) {
    const sql = buildAggregateQuery(options);
    const rows =
      await prisma.$queryRaw<
        { bucket: Date; group: string | null; count: bigint }[]
      >(sql);
    return mapAggregateRows(rows);
  }
}

export default new LogRepository();
