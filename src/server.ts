import app from "./app.js";
import retentionService from "./services/retention.service.js";
import rollupService from "./services/rollup.service.js";

const start = async () => {
  const Port = 8080;
  try {
    await rollupService.rebuildIfNeeded();

    await app.listen({
      port: Port,
      host: "0.0.0.0",
    });
    console.log(`Server is running on port ${Port}`);

    retentionService.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  retentionService.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  retentionService.stop();
  process.exit(0);
});

await start();
