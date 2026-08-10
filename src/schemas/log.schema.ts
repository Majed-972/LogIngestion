import z from "zod";

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const logSchema = z.object({
  timestamp: z.iso.datetime(),

  level: z.enum(["debug", "info", "warn", "error"]),

  service: z.string().min(1),

  message: z.string().min(1),

  attributes: z.record(z.string(), attributeValueSchema).optional(),
});

export const logsSchema = z.object({
  logs: z.array(logSchema),
});
