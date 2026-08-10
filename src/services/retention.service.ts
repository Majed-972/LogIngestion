import prisma from "../database/prisma.js";

export class RetentionService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    const retentionDays = Number(process.env["RETENTION_DAYS"]) || 30;
    const intervalHours =
      Number(process.env["RETENTION_CHECK_INTERVAL_HOURS"]) || 1;

    console.log(
      `[Retention] Service started. Retaining logs for ${retentionDays} days.`,
    );

    void this.cleanupExpiredLogs(retentionDays);

    this.timer = setInterval(
      () => {
        void this.cleanupExpiredLogs(retentionDays);
      },
      intervalHours * 60 * 60 * 1000,
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async cleanupExpiredLogs(retentionDays: number) {
    try {
      const cutoffDate = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000,
      );
      let totalDeleted = 0;
      const batchSize = 5000;

      while (true) {
        const deletedCount = await prisma.$executeRaw`
          WITH to_delete AS (
            SELECT id FROM "Log"
            WHERE timestamp < ${cutoffDate}
            LIMIT ${batchSize}
          )
          DELETE FROM "Log"
          WHERE id IN (SELECT id FROM to_delete);
        `;

        totalDeleted += deletedCount;

        if (deletedCount < batchSize) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (totalDeleted > 0) {
        console.log(
          `[Retention] Cleaned up ${totalDeleted} expired logs older than ${cutoffDate.toISOString()}`,
        );
      }
    } catch (error) {
      console.error("[Retention] Error during log cleanup:", error);
    }
  }
}

export default new RetentionService();
