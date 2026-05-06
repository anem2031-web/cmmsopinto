import ExcelJS from "exceljs";
import * as db from "./db";

// ============================================================
// EXCEL EXPORT HELPERS
// ============================================================

function styleHeader(worksheet: ExcelJS.Worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B7A4A" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 30;
  worksheet.columns.forEach(col => {
    col.width = Math.max(col.width || 15, 15);
  });
}

function addRtlSupport(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ rightToLeft: true }];
}

// ============================================================
// TICKETS EXPORT
// ============================================================
export async function exportTicketsToExcel(): Promise<Buffer> {
  const tickets = await db.getTickets();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("البلاغات");
  addRtlSupport(ws);

  ws.columns = [
    { header: "رقم البلاغ", key: "id", width: 12 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "الوصف", key: "description", width: 45 },
    { header: "الحالة", key: "status", width: 18 },
    { header: "الأولوية", key: "priority", width: 15 },
    { header: "الفئة", key: "category", width: 18 },
    { header: "الموقع", key: "siteId", width: 12 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  const statusMap: Record<string, string> = {
    open: "مفتوح", in_progress: "قيد التنفيذ", pending_approval: "بانتظار الاعتماد",
    pending_quote: "بانتظار التسعير", pending_po: "بانتظار طلب شراء",
    pending_funding: "بانتظار التمويل", closed: "مغلق", rejected: "مرفوض",
  };
  const priorityMap: Record<string, string> = {
    low: "منخفضة", medium: "متوسطة", high: "عالية", critical: "حرجة",
  };
  const categoryMap: Record<string, string> = {
    electrical: "كهرباء", plumbing: "سباكة", hvac: "تكييف", structural: "إنشائي",
    elevator: "مصاعد", fire_safety: "سلامة", cleaning: "نظافة", other: "أخرى",
  };

  tickets.forEach(t => {
    ws.addRow({
      id: t.id,
      title: t.title,
      description: t.description,
      status: statusMap[t.status] || t.status,
      priority: priorityMap[t.priority] || t.priority,
      category: categoryMap[t.category] || t.category,
      siteId: t.siteId,
      createdAt: new Date(t.createdAt).toLocaleString("ar-SA"),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// PURCHASE ORDERS EXPORT
// ============================================================
export async function exportPurchaseOrdersToExcel(): Promise<Buffer> {
  const pos = await db.getPurchaseOrders();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("طلبات الشراء");
  addRtlSupport(ws);

  ws.columns = [
    { header: "رقم الطلب", key: "poNumber", width: 18 },
    { header: "الملاحظات", key: "notes", width: 40 },
    { header: "الحالة", key: "status", width: 18 },
    { header: "التكلفة المقدرة", key: "estimated", width: 18 },
    { header: "التكلفة الفعلية", key: "actual", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  const poStatusMap: Record<string, string> = {
    draft: "مسودة", pending_approval: "بانتظار الاعتماد", approved: "معتمد",
    quoted: "تم التسعير", funded: "تم التمويل", purchased: "تم الشراء",
    received: "تم الاستلام", rejected: "مرفوض", cancelled: "ملغي",
  };

  pos.forEach(po => {
    ws.addRow({
      poNumber: po.poNumber,
      notes: po.notes || "-",
      status: poStatusMap[po.status] || po.status,
      estimated: parseFloat(po.totalEstimatedCost || "0"),
      actual: parseFloat(po.totalActualCost || "0"),
      createdAt: new Date(po.createdAt).toLocaleString("ar-SA"),
    });
  });

  // Format currency columns
  ws.getColumn("estimated").numFmt = '#,##0.00 "ر.س"';
  ws.getColumn("actual").numFmt = '#,##0.00 "ر.س"';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// TECHNICIAN PERFORMANCE EXPORT
// ============================================================
export async function exportTechnicianPerformanceToExcel(filters?: { dateFrom?: Date; dateTo?: Date }): Promise<Buffer> {
  const data = await db.getTechnicianPerformance(filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("أداء الفنيين");
  addRtlSupport(ws);

  ws.columns = [
    { header: "اسم الفني", key: "name", width: 25 },
    { header: "البلاغات المسندة", key: "assigned", width: 18 },
    { header: "المكتملة", key: "completed", width: 15 },
    { header: "نسبة الإنجاز", key: "completionRate", width: 18 },
    { header: "متوسط وقت الحل (ساعة)", key: "avgTime", width: 25 },
    { header: "درجة الأداء", key: "score", width: 18 },
  ];
  styleHeader(ws);

  data.forEach((t: any) => {
    ws.addRow({
      name: t.name,
      assigned: t.assignedTickets,
      completed: t.completedTickets,
      completionRate: `${t.completionRate}%`,
      avgTime: t.avgResolutionTime,
      score: t.performanceScore,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// AUDIT LOG EXPORT
// ============================================================
export async function exportAuditLogToExcel(filters?: any): Promise<Buffer> {
  const logs = await db.getAuditLogsEnhanced(filters);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("سجل التدقيق");
  addRtlSupport(ws);

  ws.columns = [
    { header: "التاريخ", key: "date", width: 22 },
    { header: "المستخدم", key: "user", width: 20 },
    { header: "الإجراء", key: "action", width: 18 },
    { header: "نوع الكيان", key: "entityType", width: 18 },
    { header: "رقم الكيان", key: "entityId", width: 12 },
    { header: "الوصف", key: "description", width: 45 },
    { header: "القيم القديمة", key: "oldValues", width: 40 },
    { header: "القيم الجديدة", key: "newValues", width: 40 },
  ];
  styleHeader(ws);

  const actionMap: Record<string, string> = {
    create: "إنشاء", update: "تعديل", delete: "حذف",
    status_change: "تغيير حالة", approve: "اعتماد", reject: "رفض",
    assign: "إسناد", purchase: "شراء", deliver: "توريد",
  };
  const entityMap: Record<string, string> = {
    ticket: "بلاغ", purchase_order: "طلب شراء", po_item: "صنف شراء",
    inventory: "مخزون", site: "موقع", user: "مستخدم",
  };

  logs.forEach((log: any) => {
    ws.addRow({
      date: new Date(log.createdAt).toLocaleString("ar-SA"),
      user: log.userName || `مستخدم #${log.userId}`,
      action: actionMap[log.action] || log.action,
      entityType: entityMap[log.entityType] || log.entityType,
      entityId: log.entityId,
      description: log.description,
      oldValues: log.oldValues ? JSON.stringify(log.oldValues, null, 0) : "",
      newValues: log.newValues ? JSON.stringify(log.newValues, null, 0) : "",
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// INVENTORY EXPORT
// ============================================================
export async function exportInventoryToExcel(): Promise<Buffer> {
  const items = await db.getInventoryItems();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("المخزون");
  addRtlSupport(ws);

  ws.columns = [
    { header: "اسم الصنف", key: "name", width: 30 },
    { header: "رقم القطعة", key: "partNumber", width: 18 },
    { header: "الكمية", key: "quantity", width: 12 },
    { header: "الحد الأدنى", key: "minQuantity", width: 15 },
    { header: "الوحدة", key: "unit", width: 12 },
    { header: "الموقع", key: "location", width: 20 },
    { header: "تاريخ الإضافة", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);

  items.forEach((item: any) => {
    ws.addRow({
      name: item.itemName,
      partNumber: item.partNumber || "-",
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unit: item.unit,
      location: item.location || "-",
      createdAt: new Date(item.createdAt).toLocaleString("ar-SA"),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// PREVENTIVE MAINTENANCE EXPORT - تصدير الصيانة الوقائية
// ============================================================
export async function exportPreventivePlansToExcel(): Promise<Buffer> {
  const plans = await db.listPreventivePlans();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("خطط الصيانة الوقائية");
  addRtlSupport(ws);
  ws.columns = [
    { header: "رقم الخطة", key: "planNumber", width: 15 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "التكرار", key: "frequency", width: 15 },
    { header: "الحالة", key: "isActive", width: 12 },
    { header: "موعد التنفيذ القادم", key: "nextDueDate", width: 22 },
    { header: "المدة التقديرية (دقيقة)", key: "estimatedDuration", width: 22 },
    { header: "عدد بنود التحقق", key: "checklistCount", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);
  const freqMap: Record<string, string> = {
    daily: "يومي", weekly: "أسبوعي", monthly: "شهري",
    quarterly: "ربع سنوي", biannual: "نصف سنوي", annual: "سنوي",
  };
  plans.forEach((p: any) => {
    ws.addRow({
      planNumber: p.planNumber,
      title: p.title,
      frequency: freqMap[p.frequency] || p.frequency,
      isActive: p.isActive !== false ? "نشط" : "متوقف",
      nextDueDate: p.nextDueDate ? new Date(p.nextDueDate).toLocaleDateString("ar-SA") : "-",
      estimatedDuration: p.estimatedDurationMinutes || "-",
      checklistCount: Array.isArray(p.checklist) ? p.checklist.length : 0,
      createdAt: new Date(p.createdAt).toLocaleString("ar-SA"),
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportPMWorkOrdersToExcel(): Promise<Buffer> {
  const workOrders = await db.listPMWorkOrders();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CMMS";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("أوامر العمل الوقائية");
  addRtlSupport(ws);
  ws.columns = [
    { header: "رقم أمر العمل", key: "workOrderNumber", width: 18 },
    { header: "العنوان", key: "title", width: 35 },
    { header: "الحالة", key: "status", width: 15 },
    { header: "تاريخ الجدولة", key: "scheduledDate", width: 20 },
    { header: "تاريخ الإنجاز", key: "completedDate", width: 20 },
    { header: "ملاحظات الفني", key: "technicianNotes", width: 40 },
    { header: "صورة إتمام العمل", key: "completionPhoto", width: 18 },
    { header: "تاريخ الإنشاء", key: "createdAt", width: 22 },
  ];
  styleHeader(ws);
  const statusMap: Record<string, string> = {
    scheduled: "مجدول", in_progress: "جاري", completed: "مكتمل",
    overdue: "متأخر", cancelled: "ملغي",
  };
  workOrders.forEach((wo: any) => {
    ws.addRow({
      workOrderNumber: wo.workOrderNumber,
      title: wo.title,
      status: statusMap[wo.status] || wo.status,
      scheduledDate: wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString("ar-SA") : "-",
      completedDate: wo.completedDate ? new Date(wo.completedDate).toLocaleDateString("ar-SA") : "-",
      technicianNotes: wo.technicianNotes || "-",
      completionPhoto: wo.completionPhotoUrl ? "مرفوعة" : "-",
      createdAt: new Date(wo.createdAt).toLocaleString("ar-SA"),
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// DELEGATE PURCHASING ITEMS — PDF EXPORT (ACTIVE ITEMS ONLY)
// Active statuses: pending, estimated, approved, purchased
// Excluded: delivered_to_warehouse, delivered_to_requester, rejected, funded
// Security: scoped strictly to the logged-in delegate's own items
// ============================================================
const DELEGATE_ACTIVE_STATUSES = new Set(["pending", "estimated", "approved", "purchased"]);

export async function generateDelegateItemsPDF(delegateId: number): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const allItems = await db.getPOItemsByDelegate(delegateId);

  // STRICT FILTER: active items only for this delegate
  const activeItems = (allItems as any[]).filter((item: any) =>
    DELEGATE_ACTIVE_STATUSES.has(item.status)
  );

  // Enrich each item with PO number and requesting department
  const enriched = await Promise.all(
    activeItems.map(async (item: any) => {
      const po = item.purchaseOrderId ? await db.getPurchaseOrderById(item.purchaseOrderId) : null;
      let department = "-";
      if (po?.requestedById) {
        const requester = await db.getUserById(po.requestedById);
        department = requester?.department || "-";
      }
      return { ...item, poNumber: po?.poNumber ?? "-", department };
    })
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: "Active Purchasing Items — Delegate", Author: "CMMS" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 80; // usable width

    // ── Header ──────────────────────────────────────────────
    doc.rect(40, 40, W, 56).fill("#1e40af");
    doc.fillColor("#ffffff").fontSize(17).font("Helvetica-Bold")
      .text("Active Purchasing Items Report", 50, 52, { align: "center", width: W });
    doc.fillColor("#bfdbfe").fontSize(9).font("Helvetica")
      .text(`Delegate ID: ${delegateId}  |  Active items only  |  Generated: ${new Date().toLocaleDateString("en-GB")}`, 50, 76, { align: "center", width: W });
    doc.moveDown(3);

    // ── Table header ─────────────────────────────────────────
    const cols = { poNumber: 65, itemName: 140, qty: 40, department: 100, cost: 85, total: 85 };
    const headers = ["PO #", "Item Name", "Qty", "Department", "Unit Cost (SAR)", "Total (SAR)"];
    const colKeys = Object.keys(cols) as (keyof typeof cols)[];
    const colWidths = Object.values(cols);

    let x = 40;
    const headerY = doc.y;
    doc.rect(40, headerY, W, 20).fill("#1e40af");
    colKeys.forEach((_, i) => {
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold")
        .text(headers[i], x + 3, headerY + 6, { width: colWidths[i] - 6, lineBreak: false });
      x += colWidths[i];
    });
    doc.y = headerY + 22;

    // ── Table rows ───────────────────────────────────────────
    let grandTotal = 0;
    enriched.forEach((item: any, idx: number) => {
      const rowY = doc.y;
      const shade = idx % 2 === 0;
      if (shade) doc.rect(40, rowY, W, 18).fill("#f8fafc");

      const unitCost = parseFloat(item.estimatedUnitCost || item.actualUnitCost || "0");
      const qty = item.quantity || 1;
      const rowTotal = unitCost * qty;
      grandTotal += rowTotal;

      const values = [
        item.poNumber,
        item.itemName || "-",
        String(qty),
        item.department,
        unitCost > 0 ? unitCost.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
        rowTotal > 0 ? rowTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
      ];

      x = 40;
      colKeys.forEach((_, i) => {
        doc.fillColor("#1e293b").fontSize(8).font("Helvetica")
          .text(values[i], x + 3, rowY + 4, { width: colWidths[i] - 6, lineBreak: false });
        x += colWidths[i];
      });

      doc.y = rowY + 20;

      // Page break guard
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }
    });

    // ── Total row ────────────────────────────────────────────
    const totalY = doc.y + 4;
    doc.rect(40, totalY, W, 22).fill("#1e40af");
    doc.fillColor("#ffffff").fontSize(10).font("Helvetica-Bold")
      .text(`Total: ${grandTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 })} SAR`, 50, totalY + 6, { align: "right", width: W - 10 });

    doc.moveDown(2);
    doc.fillColor("#64748b").fontSize(8).font("Helvetica")
      .text(`Active items exported: ${enriched.length}  |  Excluded: completed, delivered, rejected`, 40, doc.y, { align: "left" });

    doc.end();
  });
}
