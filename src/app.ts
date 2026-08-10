import Fastify from "fastify";
import healthRoutes from "./routes/health.route.js";
import logRoute from "./routes/log.route.js";

const app = Fastify({
  logger: process.env["NODE_ENV"] === "production" ? { level: "warn" } : true,
});

app.register(healthRoutes);
app.register(logRoute);
export default app;
