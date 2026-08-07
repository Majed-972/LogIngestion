import type { FastifyInstance } from "fastify";
import prisma from "../database/prisma.js";

export default async function healthRoutes(app: FastifyInstance) {
    app.get('/health', async (request, reply) => {
        try {
            await prisma.$queryRaw`SELECT 1`;

            return reply.status(200).send({
                status: 'ok',
                database: 'connected',
            });

        } catch (error) {
            return reply.status(503).send({
                status: 'error',
                database: 'disconnected',
            });
        }
    });
}
