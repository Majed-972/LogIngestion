import { pool } from "../database/prisma.js";

export class RollupService {
  async rebuildIfNeeded() {
    const result = await pool.query<{
      has_logs: boolean;
      has_minute_rollups: boolean;
      has_second_rollups: boolean;
    }>(`
      SELECT
        EXISTS (SELECT 1 FROM "Log") AS has_logs,
        EXISTS (SELECT 1 FROM "LogRollup") AS has_minute_rollups,
        EXISTS (SELECT 1 FROM "LogSecondRollup") AS has_second_rollups
    `);
    const state = result.rows[0];

    if (!state?.has_logs) return;

    if (!state.has_minute_rollups) {
      await pool.query(`
        INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
        SELECT
          date_trunc('minute', "timestamp") AS "bucket",
          "service",
          "level",
          COUNT(*)::bigint AS "count"
        FROM "Log"
        GROUP BY 1, 2, 3
      `);
    }

    if (!state.has_second_rollups) {
      await pool.query(`
        INSERT INTO "LogSecondRollup" ("bucket", "service", "level", "count")
        SELECT
          date_trunc('second', "timestamp") AS "bucket",
          "service",
          "level",
          COUNT(*)::bigint AS "count"
        FROM "Log"
        GROUP BY 1, 2, 3
      `);
    }
  }
}

export default new RollupService();
