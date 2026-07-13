import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

/**
 * Generates the CMMS Workflow Training Manual as a PDF buffer.
 * Uses pdfkit with embedded Arabic-compatible font (if available).
 */
export async function generateWorkflowGuidePDF(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: "CMMS Workflow Guide - دليل سير العمل",
        Author: "نظام CMMS - Tolan",
        Subject: "Workflow Status Transitions Manual",
        Keywords: "CMMS, Maintenance, Workflow, Triage, Gate Security",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover Page ──────────────────────────────────────────────────────────
    doc
      .rect(0, 0, doc.page.width, 200)
      .fill("#1e293b");

    doc
      .fillColor("#ffffff")
      .fontSize(28)
      .text("CMMS Workflow Training Manual", 50, 60, { align: "center" })
      .fontSize(16)
      .text("Status Transitions & Role Responsibilities", 50, 100, { align: "center" })
      .fontSize(12)
      .fillColor("#94a3b8")
      .text(`Generated: ${new Date().toLocaleDateString("en-GB")}`, 50, 140, { align: "center" });

    doc.moveDown(6);

    // ── Section helper ──────────────────────────────────────────────────────
    const sectionTitle = (title: string) => {
      doc
        .moveDown(1)
        .rect(50, doc.y, doc.page.width - 100, 28)
        .fill("#1e40af");
      doc
        .fillColor("#ffffff")
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(title, 58, doc.y - 22, { lineBreak: false });
      doc.moveDown(1.5).fillColor("#1e293b").font("Helvetica");
    };

    const row = (label: string, value: string, shade = false) => {
      const y = doc.y;
      if (shade) doc.rect(50, y, doc.page.width - 100, 18).fill("#f1f5f9");
      doc
        .fillColor("#374151")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(label, 58, y + 4, { width: 180, lineBreak: false })
        .font("Helvetica")
        .text(value, 245, y + 4, { width: doc.page.width - 295, lineBreak: false });
      doc.moveDown(0.9);
    };

    // ── 1. Overview ─────────────────────────────────────────────────────────
    sectionTitle("1. System Overview");
    doc
      .fontSize(10)
      .fillColor("#374151")
      .text(
        "The CMMS (Computerized Maintenance Management System) routes every maintenance ticket through three defined paths. " +
        "All tickets start at PENDING_TRIAGE and end at CLOSED. The Supervisor (Eng. Khaled) performs triage; " +
        "the Maintenance Manager (Abdel Fattah) approves work and selects the path; technicians execute repairs.",
        { align: "left" }
      );

    // ── 2. Status Reference Table ────────────────────────────────────────────
    sectionTitle("2. Status Reference Table");

    // Header
    doc.rect(50, doc.y, doc.page.width - 100, 20).fill("#334155");
    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text("#", 58, doc.y - 15, { width: 20, lineBreak: false })
      .text("Status Code", 82, doc.y - 15, { width: 140, lineBreak: false })
      .text("Arabic Name", 228, doc.y - 15, { width: 130, lineBreak: false })
      .text("Responsible Role", 362, doc.y - 15, { width: 160, lineBreak: false });
    doc.moveDown(1.2);

    const statuses = [
      ["1", "pending_triage", "Awaiting Triage", "Supervisor (Khaled)"],
      ["2", "under_inspection", "Under Inspection", "Supervisor (Khaled)"],
      ["3", "work_approved", "Work Approved", "Maintenance Manager (Abdel Fattah)"],
      ["4", "assigned", "Assigned to Technician", "Maintenance Manager"],
      ["5", "in_progress", "In Progress", "Technician"],
      ["6", "repaired", "Repaired", "Technician"],
      ["7", "needs_purchase", "Needs Purchase (Path B)", "Maintenance Manager"],
      ["8", "pending_po_approval", "Awaiting PO Approval", "Supervisor (Khaled)"],
      ["9", "po_approved", "PO Approved", "Supervisor (Khaled)"],
      ["10", "out_for_repair", "Out for External Repair (Path C)", "Gate Security"],
      ["11", "ready_for_closure", "Ready for Closure", "Supervisor / Maint. Manager"],
      ["12", "closed", "Closed", "Khaled (A) / Abdel Fattah (B/C)"],
      ["13", "cancelled", "Cancelled", "Admin / Owner"],
    ];

    statuses.forEach(([num, code, name, role], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 17).fill("#f8fafc");
      doc
        .fillColor("#1e293b")
        .fontSize(8.5)
        .font("Helvetica-Bold")
        .text(num, 58, y + 3, { width: 20, lineBreak: false })
        .font("Courier")
        .fillColor("#1d4ed8")
        .text(code, 82, y + 3, { width: 140, lineBreak: false })
        .font("Helvetica")
        .fillColor("#374151")
        .text(name, 228, y + 3, { width: 130, lineBreak: false })
        .fillColor("#6b7280")
        .text(role, 362, y + 3, { width: 160, lineBreak: false });
      doc.moveDown(0.85);
    });

    // ── 3. Path A ────────────────────────────────────────────────────────────
    doc.addPage();
    sectionTitle("3. Path A — Internal Direct Repair");
    doc.fontSize(10).fillColor("#374151").text(
      "Trigger: No spare parts needed, no external workshop required.\n" +
      "Closure Right: Supervisor (Eng. Khaled) ONLY."
    );
    doc.moveDown(0.5);

    const pathASteps = [
      ["1", "Ticket Created", "pending_triage", "System auto-assigns on creation"],
      ["2", "Supervisor Triage", "under_inspection", "Khaled: Quick Triage or Detailed Triage"],
      ["3", "Inspection Complete", "work_approved", "Khaled: Completes field inspection + notes"],
      ["4", "Manager Approves", "assigned", "Abdel Fattah: Selects Path A + assigns technician"],
      ["5", "Technician Works", "in_progress", "Technician starts repair"],
      ["6", "Repair Done", "repaired", "Technician uploads after-repair photo"],
      ["7", "Mark Ready", "ready_for_closure", "Manager marks ready for closure"],
      ["8", "Final Closure ✅", "closed", "Khaled closes the ticket (Path A only)"],
    ];

    doc.rect(50, doc.y, doc.page.width - 100, 20).fill("#1e40af");
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text("Step", 58, doc.y - 15, { width: 30, lineBreak: false })
      .text("Action", 92, doc.y - 15, { width: 130, lineBreak: false })
      .text("Resulting Status", 226, doc.y - 15, { width: 140, lineBreak: false })
      .text("Notes", 370, doc.y - 15, { width: 160, lineBreak: false });
    doc.moveDown(1.2);

    pathASteps.forEach(([step, action, status, note], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 17).fill("#eff6ff");
      doc.fillColor("#1e293b").fontSize(8.5)
        .font("Helvetica-Bold").text(step, 58, y + 3, { width: 30, lineBreak: false })
        .font("Helvetica").text(action, 92, y + 3, { width: 130, lineBreak: false })
        .font("Courier").fillColor("#1d4ed8").text(status, 226, y + 3, { width: 140, lineBreak: false })
        .font("Helvetica").fillColor("#6b7280").text(note, 370, y + 3, { width: 160, lineBreak: false });
      doc.moveDown(0.85);
    });

    // ── 4. Path B ────────────────────────────────────────────────────────────
    doc.moveDown(1);
    sectionTitle("4. Path B — Internal Repair + Procurement");
    doc.fontSize(10).fillColor("#374151").text(
      "Trigger: Repair requires spare parts not in stock.\n" +
      "Batching Rule: MAX 15 items per Purchase Order.\n" +
      "Warehouse Visibility: Warehouse sees items ONLY after Delegate confirms purchase.\n" +
      "Closure Right: Maintenance Manager (Abdel Fattah) ONLY."
    );
    doc.moveDown(0.5);

    const pathBSteps = [
      ["1-4", "Same as Path A (Triage → Approval)", "work_approved", ""],
      ["5", "Manager selects Path B", "needs_purchase", "Abdel Fattah: creates PO (max 15 items)"],
      ["6", "Khaled approves PO", "po_approved", "Batching limit enforced by system"],
      ["7", "Delegate purchases items", "—", "Delegate uploads receipt photos per item"],
      ["8", "Warehouse receives items", "—", "Warehouse confirms receipt + actual cost"],
      ["9", "Technician repairs", "in_progress → repaired", "After all items received"],
      ["10", "Ready for closure", "ready_for_closure", "Manager marks ready"],
      ["11", "Final Closure ✅", "closed", "Abdel Fattah closes (Path B only)"],
    ];

    doc.rect(50, doc.y, doc.page.width - 100, 20).fill("#065f46");
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text("Step", 58, doc.y - 15, { width: 35, lineBreak: false })
      .text("Action", 97, doc.y - 15, { width: 155, lineBreak: false })
      .text("Status", 256, doc.y - 15, { width: 130, lineBreak: false })
      .text("Notes", 390, doc.y - 15, { width: 140, lineBreak: false });
    doc.moveDown(1.2);

    pathBSteps.forEach(([step, action, status, note], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 17).fill("#ecfdf5");
      doc.fillColor("#1e293b").fontSize(8.5)
        .font("Helvetica-Bold").text(step, 58, y + 3, { width: 35, lineBreak: false })
        .font("Helvetica").text(action, 97, y + 3, { width: 155, lineBreak: false })
        .font("Courier").fillColor("#065f46").text(status, 256, y + 3, { width: 130, lineBreak: false })
        .font("Helvetica").fillColor("#6b7280").text(note, 390, y + 3, { width: 140, lineBreak: false });
      doc.moveDown(0.85);
    });

    // ── 5. Path C ────────────────────────────────────────────────────────────
    doc.addPage();
    sectionTitle("5. Path C — External Workshop Repair");
    doc.fontSize(10).fillColor("#374151").text(
      "Trigger: Asset must be sent to an external workshop.\n" +
      "Gate Protocol: NO asset may exit or enter without Gate Security digital approval.\n" +
      "Justification: Manager must provide written justification for external repair.\n" +
      "Closure Right: Maintenance Manager (Abdel Fattah) ONLY."
    );
    doc.moveDown(0.5);

    const pathCSteps = [
      ["1-4", "Same as Path A (Triage → Approval)", "work_approved", ""],
      ["5", "Manager selects Path C + justification", "out_for_repair", "Written justification required"],
      ["6", "Gate Security approves EXIT ✅", "out_for_repair", "Digital gate approval recorded"],
      ["7", "Asset at external workshop", "out_for_repair", "Delegate manages external repair"],
      ["8", "Asset returns", "—", "Delegate brings asset back"],
      ["9", "Gate Security approves ENTRY ✅", "ready_for_closure", "Digital gate entry recorded"],
      ["10", "Final Closure ✅", "closed", "Abdel Fattah closes (Path C only)"],
    ];

    doc.rect(50, doc.y, doc.page.width - 100, 20).fill("#7c3aed");
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text("Step", 58, doc.y - 15, { width: 35, lineBreak: false })
      .text("Action", 97, doc.y - 15, { width: 155, lineBreak: false })
      .text("Status", 256, doc.y - 15, { width: 130, lineBreak: false })
      .text("Notes", 390, doc.y - 15, { width: 140, lineBreak: false });
    doc.moveDown(1.2);

    pathCSteps.forEach(([step, action, status, note], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 17).fill("#faf5ff");
      doc.fillColor("#1e293b").fontSize(8.5)
        .font("Helvetica-Bold").text(step, 58, y + 3, { width: 35, lineBreak: false })
        .font("Helvetica").text(action, 97, y + 3, { width: 155, lineBreak: false })
        .font("Courier").fillColor("#7c3aed").text(status, 256, y + 3, { width: 130, lineBreak: false })
        .font("Helvetica").fillColor("#6b7280").text(note, 390, y + 3, { width: 140, lineBreak: false });
      doc.moveDown(0.85);
    });

    // ── 6. Closure Rights Matrix ─────────────────────────────────────────────
    doc.moveDown(1);
    sectionTitle("6. Closure Rights Matrix (Critical)");

    [
      ["Path A", "Supervisor (Eng. Khaled)", "ready_for_closure"],
      ["Path B", "Maintenance Manager (Abdel Fattah)", "ready_for_closure"],
      ["Path C", "Maintenance Manager (Abdel Fattah)", "ready_for_closure"],
    ].forEach(([path, who, prereq], i) => {
      const y = doc.y;
      const bg = i === 0 ? "#eff6ff" : i === 1 ? "#ecfdf5" : "#faf5ff";
      doc.rect(50, y, doc.page.width - 100, 20).fill(bg);
      doc.fillColor("#1e293b").fontSize(9)
        .font("Helvetica-Bold").text(path, 58, y + 5, { width: 60, lineBreak: false })
        .font("Helvetica").text(who, 122, y + 5, { width: 200, lineBreak: false })
        .font("Courier").fillColor("#dc2626").text(`Requires: ${prereq}`, 326, y + 5, { width: 200, lineBreak: false });
      doc.moveDown(1.1);
    });

    // ── 7. Business Rules ────────────────────────────────────────────────────
    doc.moveDown(1);
    sectionTitle("7. Critical Business Rules");

    const rules = [
      ["Batching Limit", "Maximum 15 items per Purchase Order. System enforces this — excess items are rejected."],
      ["Gate Protocol", "No asset may exit or enter without Gate Security digital approval in the system."],
      ["Warehouse Visibility", "Warehouse staff see items ONLY after the Delegate confirms purchase (status = purchased)."],
      ["Path C Justification", "Selecting Path C requires a mandatory written justification from the Maintenance Manager."],
      ["Auto-Triage", "All new tickets automatically start at pending_triage — no manual status setting needed."],
      ["NFC/RFID Auto-Fill", "Scanning an NFC/RFID tag auto-fills Asset and Location fields in the new ticket form."],
      ["SLA Indicators", "Orange badge = ticket stuck >24 hours. Red badge = ticket stuck >48 hours. Requires immediate action."],
    ];

    rules.forEach(([rule, desc], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 28).fill("#f8fafc");
      doc.fillColor("#1e293b").fontSize(9)
        .font("Helvetica-Bold").text(`• ${rule}:`, 58, y + 5, { width: 130, lineBreak: false })
        .font("Helvetica").fillColor("#374151").text(desc, 192, y + 5, { width: doc.page.width - 242 });
      doc.moveDown(0.3);
    });

    // ── 8. Role Summary ──────────────────────────────────────────────────────
    doc.addPage();
    sectionTitle("8. Role Summary & Quick Reference");

    const roles = [
      ["supervisor", "Eng. Khaled", "Triage tickets, approve POs, close Path A tickets"],
      ["maintenance_manager", "Abdel Fattah", "Approve work start, select path, close Path B/C"],
      ["technician", "Field Staff", "Execute repairs, upload after-repair photos"],
      ["gate_security", "Gate Guard", "Approve asset exit/entry for Path C"],
      ["delegate", "Procurement", "Confirm purchases, upload receipts, transport assets"],
      ["warehouse", "Warehouse", "Receive purchased items, confirm delivery to technician"],
      ["owner", "Owner", "Full system access, all operations"],
      ["admin", "System Admin", "Full system access, user management"],
    ];

    doc.rect(50, doc.y, doc.page.width - 100, 20).fill("#1e293b");
    doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold")
      .text("Role Code", 58, doc.y - 15, { width: 120, lineBreak: false })
      .text("Person", 182, doc.y - 15, { width: 100, lineBreak: false })
      .text("Key Responsibilities", 286, doc.y - 15, { width: 250, lineBreak: false });
    doc.moveDown(1.2);

    roles.forEach(([code, person, resp], i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 18).fill("#f1f5f9");
      doc.fillColor("#1e293b").fontSize(8.5)
        .font("Courier").fillColor("#1d4ed8").text(code, 58, y + 4, { width: 120, lineBreak: false })
        .font("Helvetica-Bold").fillColor("#1e293b").text(person, 182, y + 4, { width: 100, lineBreak: false })
        .font("Helvetica").fillColor("#374151").text(resp, 286, y + 4, { width: 250, lineBreak: false });
      doc.moveDown(0.9);
    });

    // ── Footer on all pages ──────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .rect(0, doc.page.height - 35, doc.page.width, 35)
        .fill("#1e293b");
      doc
        .fillColor("#94a3b8")
        .fontSize(8)
        .text(
          `CMMS Workflow Manual  |  Confidential — Internal Use Only  |  Page ${i + 1} of ${range.count}`,
          50,
          doc.page.height - 22,
          { align: "center", width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
