import { Prisma } from "@prisma/client";
import { logSchema } from "../schemas/log.schema.js";
import logRepository from "../repositories/log.repository.js";

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
          reason = "invalid attributes";
        }

        rejected.push({
          index,
          reason,
        });

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

    return {
      accepted: accepted.length,
      rejected,
    };
  }

  async getLogs(query: any) {
    const where: Prisma.LogWhereInput = {};

    if (query.since && isNaN(Date.parse(query.since))) {
      throw new Error("Invalid since");
    }

    if (query.until && isNaN(Date.parse(query.until))) {
      throw new Error("Invalid until");
    }

    if (
      query.since &&
      query.until &&
      new Date(query.until) <= new Date(query.since)
    ) {
      throw new Error("until must be later than since");
    }

    if (query.service) {
      where.service = query.service;
    }

    if (query.level) {
      where.level = query.level;
    }

    const limit = Number(query.limit) || 100;

    const logs = await logRepository.findMany(where, limit);

    return {
      logs,
      next_cursor: null,
    };
  }
}

export default new LogService();
