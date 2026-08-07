import prisma from "../database/prisma.js";
import { Prisma } from "@prisma/client";

export class LogRepository {


  async insertMany(logs: Prisma.LogCreateManyInput[]) {
    return prisma.log.createMany({
      data: logs,
    });
  }


  async findMany(where: Prisma.LogWhereInput, take: number) {
    return prisma.log.findMany({
      where,
      take,
      orderBy: [
        {
          timestamp: "desc",
        },
        {
          id: "desc",
        },
      ],
    });
  }

  
}

export default new LogRepository();
