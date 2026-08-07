import type { FastifyInstance } from "fastify";
import logController from "../controllers/log.controller.js";

export default async function (app: FastifyInstance) {


  app.post("/logs", logController.ingestLogs);
  app.get("/logs", logController.getLogs);

}