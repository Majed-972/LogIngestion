import logRepository from "../repositories/log.repository.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { isValidIsoTimestamp } from "../utils/datetime.js";
import { validateLogs } from "../validators/log.validator.js";
import { VALID_LEVELS, type QueryParams } from "../types/log.types.js";

class LogService {
  async ingestLogs(logs: unknown[]) {
    const { accepted, rejected } = validateLogs(logs);

    if (accepted.length > 0) {
      await logRepository.insertMany(accepted);
    }

    return { accepted: accepted.length, rejected };
  }

  async getLogs(query: QueryParams) {
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

    if (
      query.level &&
      !VALID_LEVELS.includes(query.level as (typeof VALID_LEVELS)[number])
    ) {
      throw new Error(
        `invalid level: '${query.level}'. Must be one of: debug, info, warn, error`,
      );
    }

    if (query.since && !isValidIsoTimestamp(query.since)) {
      throw new Error("Invalid since: must be a valid ISO 8601 timestamp");
    }
    if (query.until && !isValidIsoTimestamp(query.until)) {
      throw new Error("Invalid until: must be a valid ISO 8601 timestamp");
    }
    if (
      query.since &&
      query.until &&
      new Date(query.until) <= new Date(query.since)
    ) {
      throw new Error("until must be later than since");
    }

    let cursor: { timestamp: string; id: string } | null = null;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor);
    }

    const attrFilters: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith("attr.") && value !== undefined) {
        attrFilters[key.slice(5)] = value;
      }
    }

    const logs = await logRepository.findMany(
      {
        service: query.service,
        level: query.level,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        attrFilters,
        q: query.q,
        cursor: cursor ?? undefined,
      },
      limit + 1,
    );

    const hasNextPage = logs.length > limit;
    const rawResults = hasNextPage ? logs.slice(0, limit) : logs;

    const results = rawResults.map((log) => ({
      id: log.id,
      timestamp:
        log.timestamp instanceof Date
          ? log.timestamp.toISOString()
          : new Date(log.timestamp).toISOString(),
      level: log.level,
      service: log.service,
      message: log.message,
      attributes: (log.attributes as Record<string, unknown>) ?? {},
    }));

    const lastRawLog = rawResults[rawResults.length - 1];
    const next_cursor =
      hasNextPage && lastRawLog
        ? encodeCursor(lastRawLog.timestamp, lastRawLog.id)
        : null;

    return { logs: results, next_cursor };
  }

  async aggregateLogs(query: QueryParams) {
    if (!query.since) throw new Error("since is required");
    if (!query.until) throw new Error("until is required");
    if (!query.bucket) throw new Error("bucket is required");

    if (!isValidIsoTimestamp(query.since))
      throw new Error("Invalid since: must be a valid ISO 8601 timestamp");
    if (!isValidIsoTimestamp(query.until))
      throw new Error("Invalid until: must be a valid ISO 8601 timestamp");
    if (new Date(query.until) <= new Date(query.since))
      throw new Error("until must be later than since");

    const validBuckets = ["1m", "5m", "1h", "1d"] as const;
    if (!validBuckets.includes(query.bucket as (typeof validBuckets)[number])) {
      throw new Error("invalid bucket: must be one of 1m, 5m, 1h, 1d");
    }

    if (query.group_by && !["service", "level"].includes(query.group_by)) {
      throw new Error("invalid group_by: must be 'service' or 'level'");
    }

    if (
      query.level &&
      !VALID_LEVELS.includes(query.level as (typeof VALID_LEVELS)[number])
    ) {
      throw new Error(`invalid level: '${query.level}'`);
    }

    const attrFilters: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith("attr.") && value !== undefined) {
        attrFilters[key.slice(5)] = value;
      }
    }

    const buckets = await logRepository.aggregate({
      since: new Date(query.since),
      until: new Date(query.until),
      bucket: query.bucket,
      groupBy: query.group_by,
      service: query.service,
      level: query.level,
      q: query.q,
      attrFilters,
    });

    return { buckets };
  }
}

export default new LogService();
