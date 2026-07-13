/**
 * PM Work Order PDF Generator
 * يولّد PDF لأمر العمل الوقائي مع قائمة الفحص وحالة الأصل قبل وبعد الصيانة
 */
import PDFDocument from "pdfkit";
import { getPMWorkOrderById, getPreventivePlanById, getAssetById, getUserById, getSiteById } from "../../_core/db";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "مجدول",
  in_progress: "جاري التنفيذ",
  completed: "مكتمل",
  overdue: "متأخر",
  cancelled: "ملغى",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "#3b82f6",
  in_progress: "#f59e0b",
  completed: "#10b981",
  overdue: "#ef4444",
  cancelled: "#6b7280",
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  inactive: "غير نشط",
  under_maintenance: "تحت الصيانة",
  disposed: "مُستبعد",
};

export async function generatePMWorkOrderPDF(workOrderId: number): Promise<Buffer> {
  const wo = await getPMWorkOrderById(workOrderId);
  if (!wo) throw new Error("Work order not found");

  const plan = wo.planId ? await getPreventivePlanById(wo.planId) : null;
  const asset = wo.assetId ? await getAssetById(wo.assetId) : null;
  const assignedUser = wo.assignedToId ? await getUserById(wo.assignedToId) : null;
  const site = wo.siteId ? await getSiteById(wo.siteId) : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 45, info: {
      Title: `أمر عمل وقائي - ${wo.workOrderNumber}`,
      Author: "نظام تولان للصيانة",
    }});

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 90; // usable width
    const LEFT = 45;

    // ── Header Banner ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 75).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold")
      .text("Work Order — أمر عمل وقائي", LEFT, 14, { align: "center", width: doc.page.width - 90 });
    doc.fontSize(11).fillColor("#94a3b8")
      .text(`${wo.workOrderNumber}  |  نظام تولان للصيانة`, LEFT, 40, { align: "center", width: doc.page.width - 90 });

    // Status badge
    const statusColor = STATUS_COLORS[wo.status] ?? "#6b7280";
    const statusLabel = STATUS_LABELS[wo.status] ?? wo.status;
    doc.roundedRect(doc.page.width - 120, 20, 80, 22, 4).fill(statusColor);
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text(statusLabel, doc.page.width - 118, 27, { width: 76, align: "center" });

    doc.y = 90;

    // ── Section helper ────────────────────────────────────────────────────────
    const section = (title: string, color = "#1e40af") => {
      doc.moveDown(0.5);
      doc.rect(LEFT, doc.y, W, 22).fill(color);
      doc.fillColor("#fff").fontSize(10).font("Helvetica-Bold")
        .text(title, LEFT + 8, doc.y - 16, { lineBreak: false });
      doc.moveDown(1.2).fillColor("#1e293b").font("Helvetica");
    };

    const infoRow = (label: string, value: string, shade = false) => {
      const y = doc.y;
      if (shade) doc.rect(LEFT, y, W, 17).fill("#f8fafc");
      doc.fillColor("#6b7280").fontSize(8.5).font("Helvetica-Bold")
        .text(label, LEFT + 6, y + 4, { width: 130, lineBreak: false });
      doc.fillColor("#1e293b").font("Helvetica")
        .text(value || "—", LEFT + 140, y + 4, { width: W - 145, lineBreak: false });
      doc.moveDown(0.85);
    };

    // ── 1. Work Order Info ────────────────────────────────────────────────────
    section("1. معلومات أمر العمل", "#1e40af");
    infoRow("رقم أمر العمل", wo.workOrderNumber, false);
    infoRow("عنوان المهمة", wo.title, true);
    infoRow("الحالة", statusLabel, false);
    infoRow("تاريخ الجدولة", wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString("ar-SA") : "—", true);
    infoRow("تاريخ الإتمام", wo.completedDate ? new Date(wo.completedDate).toLocaleDateString("ar-SA") : "—", false);
    infoRow("الفني المعيّن", assignedUser?.name ?? "—", true);
    infoRow("الموقع", site?.name ?? "—", false);
    if (plan) {
      infoRow("رقم الخطة", plan.planNumber, true);
      infoRow("تكرار الصيانة", plan.frequency === "daily" ? "يومي" : plan.frequency === "weekly" ? "أسبوعي" : plan.frequency === "monthly" ? "شهري" : plan.frequency === "quarterly" ? "ربع سنوي" : plan.frequency === "biannual" ? "نصف سنوي" : "سنوي", false);
    }

    // ── 2. Asset Status ───────────────────────────────────────────────────────
    section("2. حالة الأصل", "#065f46");
    if (asset) {
      infoRow("رقم الأصل", asset.assetNumber, false);
      infoRow("اسم الأصل", asset.name, true);
      infoRow("الفئة", asset.category ?? "—", false);
      infoRow("الماركة / الموديل", `${asset.brand ?? "—"} / ${asset.model ?? "—"}`, true);
      infoRow("الرقم التسلسلي", asset.serialNumber ?? "—", false);
      infoRow("حالة الأصل الحالية", ASSET_STATUS_LABELS[asset.status] ?? asset.status, true);
      infoRow("آخر صيانة", asset.lastMaintenanceDate ? new Date(asset.lastMaintenanceDate).toLocaleDateString("ar-SA") : "—", false);
      infoRow("الصيانة القادمة", asset.nextMaintenanceDate ? new Date(asset.nextMaintenanceDate).toLocaleDateString("ar-SA") : "—", true);
    } else {
      doc.fillColor("#9ca3af").fontSize(9).text("لا يوجد أصل مرتبط بهذا أمر العمل", LEFT + 8, doc.y);
      doc.moveDown(1);
    }

    // ── 3. Checklist ─────────────────────────────────────────────────────────
    const checklist = (wo.checklistResults as any[]) ?? [];
    section("3. قائمة الفحص والتحقق", "#7c3aed");

    if (checklist.length === 0) {
      doc.fillColor("#9ca3af").fontSize(9).text("لا توجد بنود في قائمة الفحص", LEFT + 8, doc.y);
      doc.moveDown(1);
    } else {
      // Header row
      doc.rect(LEFT, doc.y, W, 18).fill("#334155");
      doc.fillColor("#fff").fontSize(8).font("Helvetica-Bold")
        .text("#", LEFT + 6, doc.y - 13, { width: 20, lineBreak: false })
        .text("بند الفحص", LEFT + 30, doc.y - 13, { width: 260, lineBreak: false })
        .text("الحالة", LEFT + 295, doc.y - 13, { width: 70, lineBreak: false })
        .text("ملاحظات", LEFT + 370, doc.y - 13, { width: W - 375, lineBreak: false });
      doc.moveDown(1);

      checklist.forEach((item: any, i: number) => {
        // Check if we need a new page
        if (doc.y > doc.page.height - 120) {
          doc.addPage();
          doc.y = 45;
        }
        const y = doc.y;
        const shade = i % 2 === 0;
        if (shade) doc.rect(LEFT, y, W, 17).fill("#f5f3ff");
        const done = item.done === true;
        // Checkbox circle
        doc.circle(LEFT + 14, y + 8, 5).stroke(done ? "#10b981" : "#d1d5db");
        if (done) doc.circle(LEFT + 14, y + 8, 3).fill("#10b981");
        doc.fillColor("#1e293b").fontSize(8).font("Helvetica")
          .text(`${i + 1}`, LEFT + 6, y + 5, { width: 20, lineBreak: false })
          .text(item.text ?? "", LEFT + 30, y + 5, { width: 260, lineBreak: false });
        // Status badge
        const doneColor = done ? "#10b981" : "#ef4444";
        const doneLabel = done ? "✓ تم" : "✗ لم يتم";
        doc.fillColor(doneColor).font("Helvetica-Bold").fontSize(7.5)
          .text(doneLabel, LEFT + 295, y + 5, { width: 70, lineBreak: false });
        // Notes
        doc.fillColor("#6b7280").font("Helvetica").fontSize(7.5)
          .text(item.notes || "—", LEFT + 370, y + 5, { width: W - 375, lineBreak: false });
        doc.moveDown(0.85);
      });

      // Summary
      const doneCount = checklist.filter((i: any) => i.done).length;
      const pct = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0;
      doc.moveDown(0.3);
      doc.rect(LEFT, doc.y, W, 20).fill("#f0fdf4");
      doc.fillColor("#065f46").fontSize(9).font("Helvetica-Bold")
        .text(`الإنجاز: ${doneCount} / ${checklist.length} بند (${pct}%)`, LEFT + 8, doc.y - 14);
      doc.moveDown(1.2);
    }

    // ── 4. Technician Notes ───────────────────────────────────────────────────
    section("4. ملاحظات الفني", "#92400e");
    const notes = wo.technicianNotes_ar || wo.technicianNotes || "لا توجد ملاحظات";
    doc.fillColor("#374151").fontSize(9).font("Helvetica")
      .text(notes, LEFT + 8, doc.y, { width: W - 16 });
    doc.moveDown(1.5);

    // ── 5. Completion Photo ───────────────────────────────────────────────────
    if (wo.completionPhotoUrl) {
      section("5. صورة إتمام العمل", "#1e293b");
      doc.fillColor("#6b7280").fontSize(9)
        .text(`رابط الصورة: ${wo.completionPhotoUrl}`, LEFT + 8, doc.y, { width: W - 16 });
      doc.moveDown(1);
    }

    // ── Signature Section ─────────────────────────────────────────────────────
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(1);
    doc.rect(LEFT, doc.y, W, 1).fill("#e2e8f0");
    doc.moveDown(0.5);

    const sigY = doc.y;
    const colW = W / 3;
    ["توقيع الفني", "توقيع المشرف", "توقيع المدير"].forEach((label, i) => {
      const x = LEFT + i * colW;
      doc.rect(x + 10, sigY + 25, colW - 20, 1).fill("#94a3b8");
      doc.fillColor("#6b7280").fontSize(8).font("Helvetica")
        .text(label, x, sigY + 30, { width: colW, align: "center" });
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.rect(0, doc.page.height - 35, doc.page.width, 35).fill("#1e293b");
    doc.fillColor("#94a3b8").fontSize(7.5)
      .text(
        `نظام تولان للصيانة  |  تم الإنشاء: ${new Date().toLocaleDateString("ar-SA")} ${new Date().toLocaleTimeString("ar-SA")}  |  ${wo.workOrderNumber}`,
        0, doc.page.height - 22, { align: "center", width: doc.page.width }
      );

    doc.end();
  });
}
