import type { FastifyReply, FastifyRequest } from "fastify";
import logService from "../services/log.service.js";

class LogController {
  async ingestLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as { logs?: unknown[] };

      if (
        !body ||
        typeof body !== "object" ||
        !("logs" in body) ||
        !Array.isArray(body.logs)
      ) {
        return reply.status(400).send({
          error: "Invalid request body",
        });
      }

      const result = await logService.ingestLogs(body.logs);

      if (result.accepted === 0) {
        return reply.status(400).send(result);
      }

      return reply.status(200).send(result);
    } catch (error) {
      request.log.error(error);

      return reply.status(500).send({
        error: "Internal Server Error",
      });
    }
  }

  async getLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await logService.getLogs(request.query);

      return reply.send(result);
    } catch (error: any) {
      request.log.error(error);

      if (
        error.message === "Invalid since" ||
        error.message === "Invalid until" ||
        error.message === "until must be later than since"
      ) {
        return reply.status(400).send({
          error: error.message,
        });
      }

      return reply.status(500).send({
        error: "Internal Server Error",
      });
    }
  }
}

export default new LogController();
