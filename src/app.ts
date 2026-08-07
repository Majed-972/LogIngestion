import Fastify from "fastify"
import healthRoutes from "./routes/health.route.js";
import logRoute from "./routes/log.route.js";

const app = Fastify({
    logger: true,
});

app.register(healthRoutes);
app.register(logRoute);
export default app;