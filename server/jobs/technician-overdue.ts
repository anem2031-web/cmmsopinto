import { getDb } from "../_core/db";
import { tickets, technicians } from "../../drizzle/schema";
import { eq, and, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

// وقت SLA حسب الأولوية (بالساعات)
const SLA_BY_PRIORITY: Record<string, number> = {
  critical: 4,
  high: 8,
  medium: 24,
  low: 72,
};
const DEFAULT_SLA_HOURS = 24;

// ── Cron reliability: prevent concurrent runs ────────────────────────────────
let _technicianOverdueRunning = false;

async function _runTechnicianOverdueJobCore() {
  const db = await getDb();
  if (!db) {
    console.error("[TechnicianOverdue] Failed to get database connection. Job aborted.");
    return;
  }

  const now = Date.now();

  // جلب البلاغات المُسندة لفنيين خارجيين ولم تُغلق بعد
  const assignedTickets = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      title: tickets.title,
      priority: tickets.priority,
      assignedAt: tickets.assignedAt,
      technicianName: technicians.name,
    })
    .from(tickets)
    .leftJoin(technicians, eq(tickets.assignedTechnicianId, technicians.id))
    .where(
      and(
        isNotNull(tickets.assignedTechnicianId),
        isNotNull(tickets.assignedAt),
        isNull(tickets.closedAt)
      )
    );

  if (assignedTickets.length === 0) return;

  // تصفية البلاغات التي تجاوزت SLA حسب أولويتها
  const overdueTickets = assignedTickets.filter(t => {
    if (!t.assignedAt) return false;
    const slaHours = SLA_BY_PRIORITY[t.priority] ?? DEFAULT_SLA_HOURS;
    const cutoff = new Date(now - slaHours * 60 * 60 * 1000);
    return new Date(t.assignedAt) < cutoff;
  });

  if (overdueTickets.length === 0) return;

  // تجميع البلاغات حسب الفني
  const byTechnician: Record<string, { name: string; items: typeof overdueTickets }> = {};
  for (const t of overdueTickets) {
    const key = t.technicianName || "غير معروف";
    if (!byTechnician[key]) byTechnician[key] = { name: key, items: [] };
    byTechnician[key].items.push(t);
  }

  // بناء نص الإشعار
  const lines = Object.values(byTechnician).map(({ name, items }) => {
    const list = items.map(t => {
      const slaHours = SLA_BY_PRIORITY[t.priority] ?? DEFAULT_SLA_HOURS;
      const hoursAgo = Math.floor((now - new Date(t.assignedAt!).getTime()) / 3600000);
      const priorityLabel = t.priority === "critical" ? "حرج" : t.priority === "high" ? "مرتفع" : t.priority === "medium" ? "متوسط" : "منخفض";
      return `  • ${t.ticketNumber} [${priorityLabel} - SLA: ${slaHours}h] - ${t.title} (منذ ${hoursAgo} ساعة)`;
    }).join("\n");
    return `الفني: ${name}\n${list}`;
  }).join("\n\n");

  try {
    await notifyOwner({
      title: `⚠️ تنبيه SLA: ${overdueTickets.length} بلاغ تجاوز الوقت المعياري`,
      content: `البلاغات التالية تجاوزت وقت SLA المحدد حسب الأولوية:\n\n${lines}\n\n---\nمعايير SLA: عاجل=4h | مرتفع=8h | متوسط=24h | منخفض=72h`,
    });
  } catch (ownerErr) {
    // notifyOwner already logs a concise warning if service is unavailable.
    // We only log here if notifyOwner throws an unexpected error.
    if (ownerErr instanceof Error) {
      console.error("[TechnicianOverdue] Unexpected error notifying owner about overdue tickets:", ownerErr.message);
    } else {
      console.error("[TechnicianOverdue] Unexpected error notifying owner about overdue tickets:", String(ownerErr));
    }
  }

  console.log(`[TechnicianOverdue] Notified about ${overdueTickets.length} overdue tickets (SLA-based)`);
}

export async function runTechnicianOverdueJob() {
  // Guard: skip if previous run is still active
  if (_technicianOverdueRunning) {
    console.warn("[TechnicianOverdue] Previous run still active — skipping this invocation");
    return;
  }

  _technicianOverdueRunning = true;
  try {
    await _runTechnicianOverdueJobCore();
  } catch (err) {
    const ts = new Date().toISOString();
    const msg = String(err);
    console.error(`[JOB_FAILURE] TechnicianOverdue ${ts} ${msg}`);

    // Retry once after 30 seconds
    console.warn("[TechnicianOverdue] Retrying once in 30 seconds...");
    await new Promise(resolve => setTimeout(resolve, 30_000));
    try {
      await _runTechnicianOverdueJobCore();
    } catch (retryError) {
      const ts2 = new Date().toISOString();
      const msg2 = String(retryError);
      console.error(`[JOB_FAILURE] TechnicianOverdue ${ts2} ${msg2} (retry also failed — stopping)`);
    }
  } finally {
    _technicianOverdueRunning = false;
  }
}
