import { pmv2SchedulerService } from "../pmv2/scheduler/service";
import { getRiyadhDateOnly } from "../pmv2/scheduler/utils";
import { isPmv2SimplifiedEnabled } from "../pmv2/simplified/feature";
import { SimplifiedScheduler } from "../pmv2/simplified/scheduler";
import { SimplifiedSqlSchedulerRepository } from "../pmv2/simplified/scheduler-repository";

let pmv2SchedulerRunning = false;

/**
 * PM V2 scheduler is additive and independent from Legacy PM automation.
 * It can run repeatedly because DB unique contracts + repair-on-rerun make it idempotent.
 */
export async function runPmv2SchedulerJob() {
  if (pmv2SchedulerRunning) {
    console.warn("[PMV2 Scheduler] Previous run still active — skipping");
    return { success: false, skipped: true };
  }

  pmv2SchedulerRunning = true;
  try {
    const date = getRiyadhDateOnly();
    const result = await pmv2SchedulerService.runForDate(date);
    let simplified: { date: string; checked: number; failed: number } | undefined;
    if (isPmv2SimplifiedEnabled()) {
      const load = async () => {
        const { getDb } = await import("../_core/db/client");
        const db = await getDb();
        if (!db) throw new Error("قاعدة البيانات غير متاحة");
        return db as any;
      };
      simplified = await new SimplifiedScheduler(new SimplifiedSqlSchedulerRepository(load)).runForDate(date);
      if (simplified.failed) console.warn(`[PMV2 Simplified Scheduler] ${simplified.failed} programs failed`);
    }
    console.log(
      `[PMV2 Scheduler] ${date}: ${result.createdTasks} tasks created, ` +
        `${result.createdTaskItems} items created, ${result.existingTasks} existing tasks, ` +
        `${result.errors.length} errors`,
    );
    if (result.errors.length) {
      console.warn("[PMV2 Scheduler] Partial errors:", result.errors);
    }
    return { success: true, skipped: false, ...result, ...(simplified ? { simplified } : {}) };
  } catch (error) {
    console.error("[PMV2 Scheduler] Failed:", error);
    return { success: false, skipped: false, error: String(error) };
  } finally {
    pmv2SchedulerRunning = false;
  }
}
