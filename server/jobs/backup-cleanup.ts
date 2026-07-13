/**
 * Backup Cleanup Job
 * Deletes backup records older than 30 days from the backups table.
 * Runs daily via setInterval registered in server/_core/index.ts.
 */
import { getDb } from "../_core/db";
import { backups } from "../../drizzle/schema";
import { lt } from "drizzle-orm";

const RETENTION_DAYS = 30;

// ── Cron reliability: prevent concurrent runs ────────────────────────────────
let _backupCleanupRunning = false;

async function _runBackupCleanupJobCore() {
  const db = await getDb();
  if (!db) {
    console.error("[BackupCleanup] Failed to get database connection. Job aborted.");
    return;
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(backups)
    .where(lt(backups.createdAt, cutoff));

  // drizzle-orm MySQL delete result: result[0].affectedRows
  const deleted = (result as any)?.[0]?.affectedRows ?? 0;
  console.log(`[BackupCleanup] Deleted ${deleted} backup(s) older than ${RETENTION_DAYS} days (cutoff: ${cutoff.toISOString()})`);
}

export async function runBackupCleanupJob() {
  // Guard: skip if previous run is still active
  if (_backupCleanupRunning) {
    console.warn("[BackupCleanup] Previous run still active — skipping this invocation");
    return;
  }

  _backupCleanupRunning = true;
  try {
    await _runBackupCleanupJobCore();
  } catch (err) {
    const ts = new Date().toISOString();
    const msg = String(err);
    console.error(`[JOB_FAILURE] BackupCleanup ${ts} ${msg}`);

    // Retry once after 30 seconds
    console.warn("[BackupCleanup] Retrying once in 30 seconds...");
    await new Promise(resolve => setTimeout(resolve, 30_000));
    try {
      await _runBackupCleanupJobCore();
    } catch (retryError) {
      const ts2 = new Date().toISOString();
      const msg2 = String(retryError);
      console.error(`[JOB_FAILURE] BackupCleanup ${ts2} ${msg2} (retry also failed — stopping)`);
    }
  } finally {
    _backupCleanupRunning = false;
  }
}
