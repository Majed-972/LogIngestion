import { pool } from "../database/prisma.js";

export class AsyncRollupService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private lastSyncedAt: Date = new Date(0);

  start() {
    this.timer = setInterval(() => {
      if (!this.isSyncing) {
        void this.syncRollups();
      }
    }, 500);
    console.log(
      "[AsyncRollup] Background rollup sync started (500ms interval)",
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
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
      console.log("[AsyncRollup] Rebuilding minute rollups from Log...");
      await pool.query(`
        INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
        SELECT
          date_trunc('minute', "timestamp") AS "bucket",
          "service",
          "level",
          COUNT(*)::bigint AS "count"
        FROM "Log"
        GROUP BY 1, 2, 3
        ON CONFLICT ("bucket", "service", "level")
        DO UPDATE SET "count" = EXCLUDED."count"
      `);
      console.log("[AsyncRollup] Minute rollup rebuild complete.");
    }

    if (!state.has_second_rollups) {
      console.log("[AsyncRollup] Rebuilding second rollups from Log...");
      await pool.query(`
        INSERT INTO "LogSecondRollup" ("bucket", "service", "level", "count")
        SELECT
          date_trunc('second', "timestamp") AS "bucket",
          "service",
          "level",
          COUNT(*)::bigint AS "count"
        FROM "Log"
        GROUP BY 1, 2, 3
        ON CONFLICT ("bucket", "service", "level")
        DO UPDATE SET "count" = EXCLUDED."count"
      `);
      console.log("[AsyncRollup] Second rollup rebuild complete.");
    }

    this.lastSyncedAt = new Date();
  }

  private async syncRollups() {
    this.isSyncing = true;
    const syncFrom = this.lastSyncedAt;
    const syncUntil = new Date();

    try {
      await pool.query(
        `WITH new_logs AS (
           SELECT
             date_trunc('minute', "timestamp") AS minute_bucket,
             date_trunc('second', "timestamp") AS second_bucket,
             "service",
             "level",
             COUNT(*)::bigint AS "count"
           FROM "Log"
           WHERE "createdAt" > $1 AND "createdAt" <= $2
           GROUP BY 1, 2, 3, 4
         ),
         minute_rollups AS (
           SELECT minute_bucket AS bucket, service, level, SUM(count)::bigint AS count
           FROM new_logs
           GROUP BY 1, 2, 3
         ),
         second_rollups AS (
           SELECT second_bucket AS bucket, service, level, count
           FROM new_logs
         ),
         upsert_minutes AS (
           INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
           SELECT bucket, service, level, count FROM minute_rollups
           ON CONFLICT ("bucket", "service", "level")
           DO UPDATE SET "count" = "LogRollup"."count" + EXCLUDED."count"
           RETURNING 1
         )
         INSERT INTO "LogSecondRollup" ("bucket", "service", "level", "count")
         SELECT bucket, service, level, count FROM second_rollups
         ON CONFLICT ("bucket", "service", "level")
         DO UPDATE SET "count" = "LogSecondRollup"."count" + EXCLUDED."count"`,
        [syncFrom, syncUntil],
      );

      this.lastSyncedAt = syncUntil;
    } catch (err) {
      console.error("[AsyncRollup] Sync error:", err);
    } finally {
      this.isSyncing = false;
    }
  }
}

export default new AsyncRollupService();
