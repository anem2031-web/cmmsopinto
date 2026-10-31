import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/_core/db/client";
process.on("uncaughtException", error => { console.error("[UAT] Startup failed:", error); process.exit(1); });

// Keep acceptance writes off production even if the local .env is changed.
const configuredDatabase = new URL(process.env.DATABASE_URL || "").pathname.slice(1).toLowerCase();
if (configuredDatabase !== "copycmms2") throw new Error("Trial server requires COPYCMMS2");
process.env.BACKGROUND_JOBS_ENABLED = "false";
process.env.WEB_PUSH_ENABLED = "false";
process.env.DELEGATE_PRICING_BUNDLES_ENABLED = "true";
process.env.PORT = "4002";
const db = await getDb();
if (!db) throw new Error("Trial database unavailable");
const [rows] = await db.execute(sql`SELECT DATABASE() AS databaseName`);
if (!Array.isArray(rows) || String((rows[0] as any)?.databaseName).toLowerCase() !== "copycmms2") {
  throw new Error("Connected database is not COPYCMMS2");
}
console.log("[UAT] COPYCMMS2 verified; schedulers and outbound web push disabled; port 4002");
await import("../../dist/index.js");
