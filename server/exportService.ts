import ExcelJS from "exceljs";
import * as db from "./db";
import { htmlToPdf } from "./htmlToPdfService";

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
// Rendering engine: Puppeteer (Chromium) via htmlToPdfService
// Active statuses: pending, estimated, approved, purchased
// Excluded: delivered_to_warehouse, delivered_to_requester, rejected, funded
// Security: scoped strictly to the logged-in delegate's own items
// ============================================================
const DELEGATE_ACTIVE_STATUSES = new Set(["pending", "estimated", "approved", "purchased"]);

export async function generateDelegateItemsPDF(delegateId: number): Promise<Buffer> {
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

  // Calculate grand total
  let grandTotal = 0;
  const rows = enriched.map((item: any) => {
    const unitCost = parseFloat(item.estimatedUnitCost || item.actualUnitCost || "0");
    const qty = item.quantity || 1;
    const rowTotal = unitCost * qty;
    grandTotal += rowTotal;
    return {
      poNumber:   item.poNumber,
      itemName:   item.itemName  || "-",
      qty:        String(qty),
      unit:       item.unit      || "-",
      department: item.department,
      unitCost:   unitCost > 0 ? unitCost.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
      rowTotal:   rowTotal > 0  ? rowTotal.toLocaleString("en-SA",  { minimumFractionDigits: 2 }) : "-",
    };
  });

  const generatedDate = new Date().toLocaleDateString("en-GB");
  const totalFormatted = grandTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 });

  // Build HTML — Chromium handles Arabic, English, RTL/LTR, and mixed text natively
  const rowsHtml = rows.map((r, i) => `
    <tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td>${escapeHtml(r.poNumber)}</td>
      <td class="item-name">${escapeHtml(r.itemName)}</td>
      <td>${escapeHtml(r.qty)}</td>
      <td class="item-name">${escapeHtml(r.unit)}</td>
      <td class="item-name">${escapeHtml(r.department)}</td>
      <td>${escapeHtml(r.unitCost)}</td>
      <td>${escapeHtml(r.rowTotal)}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Active Purchasing Items</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Arabic', 'Noto Sans', Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      background: #fff;
      padding: 0;
    }
    .header {
      background: #1e40af;
      color: #fff;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .header p  { font-size: 10px; color: #bfdbfe; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead tr {
      background: #1e40af;
      color: #fff;
    }
    thead th {
      padding: 7px 6px;
      text-align: center;
      font-weight: 700;
      border: 1px solid #1e3a8a;
    }
    tbody tr.even { background: #f8fafc; }
    tbody tr.odd  { background: #fff; }
    tbody td {
      padding: 6px 6px;
      border: 1px solid #e2e8f0;
      text-align: center;
      vertical-align: middle;
    }
    /* Item name, unit, department: preserve unicode direction automatically */
    .item-name {
      text-align: start;
      unicode-bidi: plaintext;
      direction: auto;
    }
    .total-row {
      background: #1e40af;
      color: #fff;
      font-weight: 700;
      font-size: 11px;
    }
    .total-row td {
      padding: 8px 6px;
      border: 1px solid #1e3a8a;
    }
    .footer {
      margin-top: 12px;
      font-size: 9px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Active Purchasing Items Report</h1>
    <p>Active items only &nbsp;|&nbsp; Generated: ${generatedDate} &nbsp;|&nbsp; Items: ${rows.length}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th>PO #</th>
        <th>Item Name</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Department</th>
        <th>Unit Cost (SAR)</th>
        <th>Total (SAR)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="6" style="text-align:end; padding-inline-end:12px;">Total</td>
        <td>${escapeHtml(totalFormatted)} SAR</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    Excluded: completed, delivered to warehouse, delivered to requester, rejected
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}

/** Escape HTML special characters to prevent XSS in generated report */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// ============================================================
// PURCHASE REQUEST PDF EXPORT (SINGLE REQUEST)
// Rendering engine: Puppeteer (Chromium) via htmlToPdfService
// Security: scoped to authenticated delegate's own request
// ============================================================

export async function generatePurchaseRequestPDF(
  purchaseOrderId: number,
  delegateId: number,
  batchId?: number
): Promise<Buffer> {
  // Fetch PO and items
  const po = await db.getPurchaseOrderById(purchaseOrderId);
  if (!po) throw new Error("Purchase Request not found");

  const allItemsRaw = await db.getPOItems(purchaseOrderId);
  if (!allItemsRaw || allItemsRaw.length === 0) throw new Error("No items found for this request");

  // ── لو تم تحديد دفعة معينة، اقتصر على أصنافها فقط (لطلب عهدة مرتبط بدفعة محددة) ──
  let batch: any = null;
  let allItems = allItemsRaw as any[];
  if (batchId) {
    batch = await db.getPOPricingBatchById(batchId);
    if (!batch || batch.purchaseOrderId !== purchaseOrderId) throw new Error("Pricing batch not found for this request");
    allItems = (allItemsRaw as any[]).filter((item: any) => item.batchId === batchId);
    if (allItems.length === 0) throw new Error("No items found for this batch");
  }

  // Verify delegate owns at least one item in this PO
  const delegateItems = (allItems as any[]).filter((item: any) => item.delegateId === delegateId);
const requestingUser = await db.getUserById(delegateId);
const canViewAll = ["admin", "owner", "maintenance_manager", "purchase_manager"].includes(requestingUser?.role || "");
if (delegateItems.length === 0 && !canViewAll) throw new Error("Access denied: not your request");

// Get delegate user info
const delegate = await db.getUserById(delegateId);
const delegateName = delegate?.name || "Unknown";

const requester = po.requestedById
  ? await db.getUserById(po.requestedById)
  : null;

const reviewer = po.reviewedById
  ? await db.getUserById(po.reviewedById)
  : null;

const requesterName = requester?.name || "-";
const reviewerName = reviewer?.name || "-";

  // Calculate totals for all items in the PO
  let grandTotal = 0;
  const rows = (allItems as any[]).map((item: any) => {
    const unitCost = parseFloat(item.estimatedUnitCost || item.actualUnitCost || "0");
    const qty = item.quantity || 1;
    const rowTotal = unitCost * qty;
    grandTotal += rowTotal;
    return {
      itemName: item.itemName || "-",
      qty: String(qty),
      unit: item.unit || "-",
      unitCost: unitCost > 0 ? unitCost.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
      rowTotal: rowTotal > 0 ? rowTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 }) : "-",
    };
  });

  const generatedDate = new Date().toLocaleDateString("en-GB");
  const totalFormatted = grandTotal.toLocaleString("en-SA", { minimumFractionDigits: 2 });

  // Build HTML — reuse existing delegate PDF style
  const rowsHtml = rows.map((r, i) => `
    <tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td class="item-name">${escapeHtml(r.itemName)}</td>
      <td>${escapeHtml(r.qty)}</td>
      <td class="item-name">${escapeHtml(r.unit)}</td>
      <td>${escapeHtml(r.unitCost)}</td>
      <td>${escapeHtml(r.rowTotal)}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Request ${po.poNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Arabic', 'Noto Sans', Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      background: #fff;
      padding: 0;
    }
    .header {
      background: #1e40af;
      color: #fff;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .header p  { font-size: 10px; color: #bfdbfe; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead tr {
      background: #1e40af;
      color: #fff;
    }
    thead th {
      padding: 7px 6px;
      text-align: center;
      font-weight: 700;
      border: 1px solid #1e3a8a;
    }
    tbody tr.even { background: #f8fafc; }
    tbody tr.odd  { background: #fff; }
    tbody td {
      padding: 6px 6px;
      border: 1px solid #e2e8f0;
      text-align: center;
      vertical-align: middle;
    }
    .item-name {
      text-align: start;
      unicode-bidi: plaintext;
      direction: auto;
    }
    .total-row {
      background: #1e40af;
      color: #fff;
      font-weight: 700;
      font-size: 11px;
    }
    .total-row td {
      padding: 8px 6px;
      border: 1px solid #1e3a8a;
    }
    .footer {
      margin-top: 12px;
      font-size: 9px;
      color: #64748b;
      text-align: left;
      direction: ltr;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Purchase Request ${escapeHtml(po.poNumber)}${batch ? ` — Batch #${batch.batchNumber}` : ""}</h1>
    <p>Generated: ${generatedDate} &nbsp;|&nbsp; Items: ${rows.length}${batch?.custodyAmount ? ` &nbsp;|&nbsp; Custody Amount: ${Number(batch.custodyAmount).toLocaleString("en-SA", { minimumFractionDigits: 2 })} SAR` : ""}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th>Item Name</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Unit Price (SAR)</th>
        <th>Total (SAR)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="4" style="text-align:end; padding-inline-end:12px;">Total</td>
        <td>${escapeHtml(totalFormatted)} SAR</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    <div>Prepared by: ${escapeHtml(delegateName)}</div>
    <div>Requester: ${escapeHtml(requesterName)}</div>
    <div>Reviewed by: ${escapeHtml(reviewerName)}</div>
  </div>
</body>
</html>`;

  return htmlToPdf(html);
}
