import { getDb } from "../_core/db";
import { pmWorkOrders } from "../../drizzle/schema";
import { and, isNull, lt, ne, sql } from "drizzle-orm";
import { sendPushToUser } from "../services/notifications/webPush";
import { notifyOwner } from "../_core/notification";

const SLA_HOURS = 48;

// ── Cron reliability: prevent concurrent runs ────────────────────────────────
let _slaOverduePushRunning = false;

async function _runSlaOverduePushJobCore() {
  const db = await getDb();
  if (!db) {
    console.error("[SlaOverduePush] Failed to get database connection. Job aborted.");
    return;
  }

  const now = Date.now();
  const cutoffMs = now - SLA_HOURS * 60 * 60 * 1000;

  // جلب أوامر العمل الوقائية التي تجاوزت 48 ساعة دون إغلاق
  const overdueOrders = await db
    .select({
      id: pmWorkOrders.id,
      workOrderNumber: pmWorkOrders.workOrderNumber,
      title: pmWorkOrders.title,
      assignedToId: pmWorkOrders.assignedToId,
      scheduledDate: pmWorkOrders.scheduledDate,
      status: pmWorkOrders.status,
    })
    .from(pmWorkOrders)
    .where(
      and(
        isNull(pmWorkOrders.completedDate),
        ne(pmWorkOrders.status, "completed"),
        ne(pmWorkOrders.status, "cancelled"),
        lt(pmWorkOrders.scheduledDate, new Date(cutoffMs))
      )
    );

  if (overdueOrders.length === 0) {
    console.log("[SlaOverduePush] No overdue PM work orders found.");
    return;
  }

  let notifiedCount = 0;

  for (const order of overdueOrders) {
    const hoursOverdue = Math.floor((now - new Date(order.scheduledDate).getTime()) / 3600000);

    // إرسال Push للفني المعيّن
    if (order.assignedToId) {
      try {
        await sendPushToUser(order.assignedToId, {
          title: `⏰ تجاوز SLA: أمر عمل #${order.workOrderNumber}`,
          body: `أمر العمل "${order.title}" تجاوز ${hoursOverdue} ساعة دون إغلاق. يرجى التحديث الفوري.`,
          url: "/preventive-maintenance",
        });
        notifiedCount++;
      } catch (e) {
        console.warn(`[SlaOverduePush] Push notification failed for WO ${order.workOrderNumber}:`, e);
      }
    }
  }

  // إشعار للمدير عبر notifyOwner
  const orderList = overdueOrders
    .map(o => {
      const hrs = Math.floor((now - new Date(o.scheduledDate).getTime()) / 3600000);
      return `  • #${o.workOrderNumber} - ${o.title} (منذ ${hrs} ساعة)`;
    })
    .join("\n");

  try {
    await notifyOwner({
      title: `🔴 تنبيه SLA: ${overdueOrders.length} أمر عمل وقائي تجاوز 48 ساعة`,
      content: `الأوامر التالية تجاوزت الوقت المعياري (48 ساعة) دون إغلاق:\n\n${orderList}\n\nيرجى المراجعة الفورية.`,
    });
  } catch (ownerErr) {
    // notifyOwner already logs a concise warning if service is unavailable.
    // We only log here if notifyOwner throws an unexpected error.
    if (ownerErr instanceof Error) {
      console.error("[SlaOverduePush] Unexpected error notifying owner about overdue SLAs:", ownerErr.message);
    } else {
      console.error("[SlaOverduePush] Unexpected error notifying owner about overdue SLAs:", String(ownerErr));
    }
  }

  console.log(`[SlaOverduePush] Notified about ${overdueOrders.length} overdue orders, ${notifiedCount} push sent.`);
}

export async function runSlaOverduePushJob() {
  // Guard: skip if previous run is still active
  if (_slaOverduePushRunning) {
    console.warn("[SlaOverduePush] Previous run still active — skipping this invocation");
    return;
  }

  _slaOverduePushRunning = true;
  try {
    await _runSlaOverduePushJobCore();
  } catch (err) {
    const ts = new Date().toISOString();
    const msg = String(err);
    console.error(`[JOB_FAILURE] SlaOverduePush ${ts} ${msg}`);

    // Retry once after 30 seconds
    console.warn("[SlaOverduePush] Retrying once in 30 seconds...");
    await new Promise(resolve => setTimeout(resolve, 30_000));
    try {
      await _runSlaOverduePushJobCore();
    } catch (retryError) {
      const ts2 = new Date().toISOString();
      const msg2 = String(retryError);
      console.error(`[JOB_FAILURE] SlaOverduePush ${ts2} ${msg2} (retry also failed — stopping)`);
    }
  } finally {
    _slaOverduePushRunning = false;
  }
}
