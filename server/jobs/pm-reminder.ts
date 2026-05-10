/**
 * PM Work Order Reminder Job
 * يُرسل إشعار تذكيري للفني إذا لم يُحدَّث أمر العمل خلال 24 ساعة من موعده
 * يُشغَّل كل ساعتين
 */
import { getDb } from "../db";
import { pmWorkOrders, preventivePlans } from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { sendPushToUser } from "../webPush";

const REMINDER_THRESHOLD_HOURS = 24;

// ── Cron reliability: prevent concurrent runs ────────────────────────────────
let _pmReminderRunning = false;

async function _runPMWorkOrderReminderJobCore() {
  const db = await getDb();
  if (!db) {
    console.error("[PM Reminder] Failed to get database connection. Job aborted.");
    return;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - REMINDER_THRESHOLD_HOURS * 60 * 60 * 1000);

  // جلب أوامر العمل المجدولة أو الجارية التي لم تُحدَّث منذ أكثر من 24 ساعة
  const staleOrders = await db
    .select()
    .from(pmWorkOrders)
    .where(
      and(
        inArray(pmWorkOrders.status, ["scheduled", "in_progress"]),
      )
    );

  // فلترة الأوامر التي scheduledDate مضى عليها أكثر من 24 ساعة ولم تُحدَّث
  const overdueOrders = staleOrders.filter((wo) => {
    if (!wo.scheduledDate) return false;
    const scheduled = new Date(wo.scheduledDate);
    // الأمر يُعتبر متأخراً إذا مضى على موعده أكثر من 24 ساعة
    return scheduled <= cutoff;
  });

  if (overdueOrders.length === 0) {
    console.log("[PM Reminder] No stale work orders found");
    return;
  }

  let notifiedCount = 0;
  const ownerLines: string[] = [];

  for (const wo of overdueOrders) {
    const hoursOverdue = Math.floor(
      (now.getTime() - new Date(wo.scheduledDate!).getTime()) / (1000 * 60 * 60)
    );

    // إرسال push للفني المعيّن
    if (wo.assignedToId) {
      try {
        const result = await sendPushToUser(wo.assignedToId, {
          title: "⏰ تذكير: أمر عمل بحاجة للتحديث",
          body: `أمر العمل ${wo.workOrderNumber} - ${wo.title} لم يُحدَّث منذ ${hoursOverdue} ساعة`,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          tag: `pm-reminder-${wo.workOrderNumber}`,
          url: "/preventive",
          type: "pm_reminder",
        });
        if (result.sent > 0) {
          notifiedCount++;
          console.log(`[PM Reminder] Reminder sent to technician (userId=${wo.assignedToId}) for WO ${wo.workOrderNumber} (${hoursOverdue}h overdue)`);
        }
      } catch (err) {
        console.warn(`[PM Reminder] Push failed for WO ${wo.workOrderNumber}:`, err);
      }
    }

    ownerLines.push(`• ${wo.workOrderNumber} - ${wo.title} (منذ ${hoursOverdue} ساعة)`);
  }

  // إشعار المالك بملخص
  if (overdueOrders.length > 0) {
    try {
      await notifyOwner({
        title: `⏰ تذكير صيانة وقائية: ${overdueOrders.length} أمر عمل بدون تحديث`,
        content: `الأوامر التالية تجاوزت ${REMINDER_THRESHOLD_HOURS} ساعة بدون تحديث من الفني:\n\n${ownerLines.join("\n")}\n\nتم إشعار ${notifiedCount} فني`,
      });
    } catch (ownerErr) {
      // notifyOwner already logs a concise warning if service is unavailable.
      // We only log here if notifyOwner throws an unexpected error.
      if (ownerErr instanceof Error) {
        console.error("[PM Reminder] Unexpected error notifying owner about overdue PMs:", ownerErr.message);
      } else {
        console.error("[PM Reminder] Unexpected error notifying owner about overdue PMs:", String(ownerErr));
      }
    }
  }

  console.log(`[PM Reminder] Completed: ${overdueOrders.length} stale orders, ${notifiedCount} technicians notified`);
}

export async function runPMWorkOrderReminderJob() {
  // Guard: skip if previous run is still active
  if (_pmReminderRunning) {
    console.warn("[PM Reminder] Previous run still active — skipping this invocation");
    return;
  }

  _pmReminderRunning = true;
  try {
    await _runPMWorkOrderReminderJobCore();
  } catch (err) {
    const ts = new Date().toISOString();
    const msg = String(err);
    console.error(`[JOB_FAILURE] PMReminder ${ts} ${msg}`);

    // Retry once after 30 seconds
    console.warn("[PM Reminder] Retrying once in 30 seconds...");
    await new Promise(resolve => setTimeout(resolve, 30_000));
    try {
      await _runPMWorkOrderReminderJobCore();
    } catch (retryError) {
      const ts2 = new Date().toISOString();
      const msg2 = String(retryError);
      console.error(`[JOB_FAILURE] PMReminder ${ts2} ${msg2} (retry also failed — stopping)`);
    }
  } finally {
    _pmReminderRunning = false;
  }
}
