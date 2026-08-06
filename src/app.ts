import Fastify from "fastify"
import healthRoutes from "./routes/health.route.js";


const app = Fastify({
    logger: true,
});

app.register(healthRoutes);

export default app;