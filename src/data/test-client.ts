import "dotenv/config";
import { execFileSync } from "node:child_process";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";

function testUrls(): { pooled: string; direct: string } {
  const pooled = process.env.TEST_DATABASE_URL;
  const direct = process.env.TEST_DIRECT_URL ?? pooled;
  if (!pooled || !direct) {
    throw new Error("TEST_DATABASE_URL (and preferably TEST_DIRECT_URL) must target a disposable Neon test branch");
  }
  if (pooled === process.env.DATABASE_URL || direct === process.env.DIRECT_URL) {
    throw new Error("Refusing to reset a test database URL that matches the application database URL");
  }
  return { pooled, direct };
}

export function resetTestDatabase(): void {
  const { pooled, direct } = testUrls();
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "prisma", "migrate", "reset", "--force", "--skip-generate",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: pooled, DIRECT_URL: direct },
    stdio: "pipe",
  });
}

export function createTestPrismaClient(): PrismaClient {
  const { pooled } = testUrls();
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: pooled }) });
}
