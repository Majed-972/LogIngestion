import { Prisma } from "@prisma/client";
import { logSchema } from "../schemas/log.schema.js";
import logRepository from "../repositories/log.repository.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

const VALID_LEVELS = ["debug", "info", "warn", "error"] as const;

class LogService {

  async ingestLogs(logs: unknown[]) {
    const accepted: Prisma.LogCreateManyInput[] = [];
    const rejected: { index: number; reason: string }[] = [];

    logs.forEach((log, index) => {
      const result = logSchema.safeParse(log);

      if (!result.success) {
        const issue = result.error.issues[0]!;
        let reason = issue.message;

        if (issue.path.includes("level")) {
          reason = `invalid level: '${(log as any).level}'`;
        } else if (issue.path.includes("timestamp")) {
          reason = "invalid timestamp";
        } else if (issue.path.includes("service")) {
          reason = "service is required";
        } else if (issue.path.includes("message")) {
          reason = "message is required";
        } else if (issue.path.includes("attributes")) {
          reason = "invalid attributes: must be a flat object with string, number, or boolean values";
        }

        rejected.push({ index, reason });
        return;
      }

      const data = result.data;

      if (new Date(data.timestamp).getTime() > Date.now() + 5 * 60 * 1000) {
        rejected.push({
          index,
          reason: "timestamp is more than five minutes in the future",
        });
        return;
      }

      accepted.push({
        timestamp: new Date(data.timestamp),
        level: data.level,
        service: data.service,
        message: data.message,
        attributes: data.attributes ?? {},
      });
    });

    if (accepted.length > 0) {
      await logRepository.insertMany(accepted);
    }

    return { accepted: accepted.length, rejected };
  }

  async getLogs(query: any) {
    const rawLimit = query.limit;
    let limit = 100;

    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || isNaN(parsed)) {
        throw new Error("limit must be a number");
      }
      if (parsed < 1 || parsed > 1000) {
        throw new Error("limit must be between 1 and 1000");
      }
      limit = parsed;
    }

    if (query.level && !VALID_LEVELS.includes(query.level)) {
      throw new Error(`invalid level: '${query.level}'. Must be one of: debug, info, warn, error`);
    }

    if (query.since && isNaN(Date.parse(query.since))) {
      throw new Error("Invalid since: must be a valid ISO 8601 timestamp");
    }
    if (query.until && isNaN(Date.parse(query.until))) {
      throw new Error("Invalid until: must be a valid ISO 8601 timestamp");
    }
    if (query.since && query.until && new Date(query.until) <= new Date(query.since)) {
      throw new Error("until must be later than since");
    }

    let cursor: { timestamp: string; id: string } | null = null;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor); // سيرمي error إذا كان غير صالح
    }

    const andConditions: Prisma.LogWhereInput[] = [];

    if (query.service) {
      andConditions.push({ service: query.service });
    }

    if (query.level) {
      andConditions.push({ level: query.level });
    }

    if (query.since || query.until) {
      andConditions.push({
        timestamp: {
          ...(query.since ? { gte: new Date(query.since) } : {}),
          ...(query.until ? { lt: new Date(query.until) } : {}),
        },
      });
    }

    for (const [key, value] of Object.entries(query as Record<string, string>)) {
      if (key.startsWith("attr.")) {
        const attrKey = key.slice(5);
        andConditions.push({
          attributes: {
            path: [attrKey],
            equals: value,
          },
        });
      }
    }

    if (query.q) {
      andConditions.push({
        message: {
          contains: query.q,
          mode: "insensitive",
        },
      });
    }

    if (cursor) {
      andConditions.push({
        OR: [
          { timestamp: { lt: new Date(cursor.timestamp) } },
          {
            timestamp: { equals: new Date(cursor.timestamp) },
            id: { lt: cursor.id },
          },
        ],
      });
    }

    const where: Prisma.LogWhereInput =
      andConditions.length > 0 ? { AND: andConditions } : {};

    const logs = await logRepository.findMany(where, limit + 1);

    const hasNextPage = logs.length > limit;
    const results = hasNextPage ? logs.slice(0, limit) : logs;

    const lastLog = results[results.length - 1];
    const next_cursor =
      hasNextPage && lastLog
        ? encodeCursor(lastLog.timestamp, lastLog.id)
        : null;

    return { logs: results, next_cursor };
  }
}

export default new LogService();
