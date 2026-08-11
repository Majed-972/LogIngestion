import {
  VALID_LEVELS,
  type LogLevelType,
  type ValidatedLogInput,
} from "../types/log.types.js";
import { isValidIsoTimestamp } from "../utils/datetime.js";

export function validateLogs(logs: unknown[]): {
  accepted: ValidatedLogInput[];
  rejected: { index: number; reason: string }[];
} {
  const accepted: ValidatedLogInput[] = [];
  const rejected: { index: number; reason: string }[] = [];
  const maxFutureTime = Date.now() + 5 * 60 * 1000;

  const len = logs.length;
  for (let index = 0; index < len; index++) {
    const log = logs[index];

    if (typeof log !== "object" || log === null || Array.isArray(log)) {
      rejected.push({ index, reason: "invalid log entry" });
      continue;
    }

    const item = log as Record<string, unknown>;

    // 1. Validate timestamp
    if (!isValidIsoTimestamp(item["timestamp"])) {
      rejected.push({ index, reason: "invalid timestamp" });
      continue;
    }
    const timeParsed = Date.parse(item["timestamp"]);
    if (timeParsed > maxFutureTime) {
      rejected.push({
        index,
        reason: "timestamp is more than five minutes in the future",
      });
      continue;
    }

    // 2. Validate level
    const levelStr = item["level"];
    if (
      typeof levelStr !== "string" ||
      !VALID_LEVELS.includes(levelStr as LogLevelType)
    ) {
      rejected.push({
        index,
        reason: `invalid level: '${String(levelStr)}'`,
      });
      continue;
    }

    // 3. Validate service
    if (typeof item["service"] !== "string" || item["service"].length === 0) {
      rejected.push({ index, reason: "service is required" });
      continue;
    }

    // 4. Validate message
    if (typeof item["message"] !== "string" || item["message"].length === 0) {
      rejected.push({ index, reason: "message is required" });
      continue;
    }

    // 5. Validate attributes
    let attrs: Record<string, string | number | boolean> = {};
    if (item["attributes"] !== undefined && item["attributes"] !== null) {
      if (
        typeof item["attributes"] !== "object" ||
        Array.isArray(item["attributes"])
      ) {
        rejected.push({
          index,
          reason:
            "invalid attributes: must be a flat object with string, number, or boolean values",
        });
        continue;
      }

      const rawAttrs = item["attributes"] as Record<string, unknown>;
      let attrsValid = true;
      for (const [, v] of Object.entries(rawAttrs)) {
        const vType = typeof v;
        if (vType !== "string" && vType !== "number" && vType !== "boolean") {
          rejected.push({
            index,
            reason:
              "invalid attributes: must be a flat object with string, number, or boolean values",
          });
          attrsValid = false;
          break;
        }
      }
      if (!attrsValid) continue;
      attrs = rawAttrs as Record<string, string | number | boolean>;
    }

    accepted.push({
      timestamp: item["timestamp"],
      level: levelStr as LogLevelType,
      service: item["service"],
      message: item["message"],
      attributes: attrs,
    });
  }

  return { accepted, rejected };
}
