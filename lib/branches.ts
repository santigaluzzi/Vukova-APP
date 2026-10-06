import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { branches } from "@/db/schema";
import { defaultBranches } from "./branch-catalog";

export { defaultBranches };

export async function ensureDefaultBranches() {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .insert(branches)
    .values(
      defaultBranches.map((branch) => ({
        ...branch,
        active: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({ target: branches.code });
  return db.select().from(branches).where(eq(branches.active, true));
}
