import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const ex = await db.excludedTarget.findMany({ where: { projectId: "8bc10925-b50a-47b5-b3c3-65495535cc99" } });
console.log("Excluded:", ex.map(e => e.value).join(", "));
await db.$disconnect();
