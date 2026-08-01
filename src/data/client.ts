import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must contain the pooled Neon PostgreSQL connection string");
const adapter = new PrismaNeon({ connectionString: databaseUrl });

export const prisma = new PrismaClient({ adapter });
