import { describe, expect, it } from "vitest";
import { buildDashboard, dashboardDetails, dashboardPeriod, dashboardSummary, DASHBOARD_METRICS } from "../../shared/dashboard-overview";
import { fixture, ticket, purchase, NOW, FILTERS, HOUR } from "../../tools/dashboard-development/fixture";

describe("real dashboard counting contracts without database access", () => {
  it("tracks 48-hour triage and the inspection deadline with a one-hour grace without guessing legacy deadlines", () => {
    const data = fixture();
    data.tickets = [ticket(1, { status: "pending_triage", createdAt: NOW - 49 * HOUR }), ticket(2, { workflowModel: "sub_ticket", parentTicketId: 1, status: "under_inspection" })];
    data.teams = [{ id: 40, ticketId: 2, managerId: 10, stage: "action_required", teamName: "فريق", createdAt: NOW - 4 * HOUR, enteredAt: NOW - 4 * HOUR, note: null, inspectionMinutes: 120, startedAt: null, outcomeAt: null }];
    data.orders = []; data.purchases = []; data.teamPurchaseLinks = [];
    let report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.work_triage).toBe(1);
    expect(report.counts.work_start).toBe(1);
    expect(report.counts.work_overdue).toBe(2);
    data.teams[0].createdAt = NOW - 3 * HOUR;
    report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.work_overdue).toBe(1); // exact grace boundary is not yet overdue
    data.teams[0].inspectionMinutes = null;
    report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.work_start).toBe(1); expect(report.counts.work_overdue).toBe(1);
    data.teams[0].startedAt = NOW - HOUR;
    expect(buildDashboard(data, FILTERS, NOW).counts.work_active).toBe(1);
    data.teams[0].outcomeAt = NOW - 1000;
    expect(buildDashboard(data, FILTERS, NOW).counts.work_active).toBe(0);
  });
  it("counts only actionable purchases linked to a report and never includes drafts or unrelated purchases", () => {
    const data = fixture(); data.purchases = [purchase(1, { status: "pending", receivedAt: null }), purchase(2, { status: "cancelled", receivedAt: null }), purchase(3, { orderId: 999, status: "pending", receivedAt: null })];
    data.teamPurchaseLinks = [{ ticketId: 4, purchaseItemId: 1 }];
    data.orders.push({ id: 999, poNumber: "PR-unlinked", status: "pending_estimate", ticketId: null, siteId: 1, requestedById: 10 });
    expect(buildDashboard(data, FILTERS, NOW).metrics.work_purchases.map(row => row.id)).toEqual([1]);
  });
  it("filters the cards by report search, recorded responsible and overdue without assigning accounting work to the delegate", () => {
    const data = fixture(); data.tickets = [ticket(4)];
    data.purchases = [purchase(1, { status: "estimated", batchStatus: "pending_accounting", receivedAt: null, requiredDate: "2026-10-12" }), purchase(2, { status: "pending", receivedAt: null, requiredDate: "2026-10-12" })];
    data.teamPurchaseLinks = [{ ticketId: 4, purchaseItemId: 1 }, { ticketId: 4, purchaseItemId: 2 }];
    const all = buildDashboard(data, FILTERS, NOW);
    expect(all.counts.work_overdue).toBe(2);
    expect(all.metrics.work_purchases.find(row => row.id === 1)).toMatchObject({ waitOwner: "accounting", actorIds: [] });
    expect(buildDashboard(data, { ...FILTERS, responsibleId: 20 }, NOW).metrics.work_purchases.map(row => row.id)).toEqual([2]);
    expect(buildDashboard(data, { ...FILTERS, workType: "reports" }, NOW).counts.work_purchases).toBe(0);
    expect(buildDashboard(data, { ...FILTERS, search: "MT-2026-00004", workStatus: "overdue" }, NOW).counts.work_purchases).toBe(2);
    expect(buildDashboard(data, { ...FILTERS, search: "not-found" }, NOW).counts.work_purchases).toBe(0);
  });
  it("keeps blockers, external maintenance and manager review visible after the technician records a result", () => {
    const data = fixture(); data.tickets = [ticket(4)];
    data.teams = ["blocked", "external_requested", "awaiting_review"].map((stage, i) => ({ id: 40 + i, ticketId: 4, managerId: 10, stage, teamName: `فريق ${i}`, createdAt: NOW - 4 * HOUR, enteredAt: NOW - HOUR, note: "سبب", outcomeAt: NOW - HOUR }));
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.work_blocked).toBe(1); expect(report.counts.work_external).toBe(1); expect(report.counts.work_review).toBe(1);
    expect(report.metrics.work_blocked[0]).toMatchObject({ waitOwner: "maintenance", actorIds: [10], note: "سبب" });
    expect(report.counts.work_overdue).toBe(0);
  });
  it("keeps a warehouse receipt visible for an open linked ticket without guessing who holds a purchased item", () => {
    const data = fixture(); data.tickets = [ticket(4)];
    data.purchases = [purchase(1, { status: "purchased", receivedAt: null }), purchase(2, { status: "delivered_to_warehouse" })];
    data.teamPurchaseLinks = [{ ticketId: 4, purchaseItemId: 1 }, { ticketId: 4, purchaseItemId: 2 }];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.metrics.work_purchases.find(row => row.id === 1)).toMatchObject({ waitOwner: "unknown", actorIds: [] });
    expect(report.metrics.work_purchases.find(row => row.id === 2)?.workLabel).toContain("راجع الصرف");
    data.tickets[0].status = "closed";
    expect(buildDashboard(data, FILTERS, NOW).metrics.work_purchases.map(row => row.id)).toEqual([1]);
  });
  it("shows recorded material and repair actions in order without inventing an absent stage", () => {
    const data = fixture(); data.tickets = [ticket(4)];
    data.teams = [{ id: 40, ticketId: 4, managerId: 10, stage: "awaiting_review", teamName: "فريق", createdAt: NOW - 4 * HOUR, enteredAt: NOW - HOUR, note: null, startedAt: NOW - 3 * HOUR, outcomeAt: NOW - 2 * HOUR, outcomeKind: "needs_material", followupEvents: [{ kind: "purchase_requested", at: NOW - 1.5 * HOUR, actorId: 10, note: "طلب شراء" }, { kind: "warehouse_issue", at: NOW - HOUR, actorId: 10, note: "صرف" }] }];
    const journey = buildDashboard(data, FILTERS, NOW).metrics.work_review[0].journey!;
    expect(journey.map(event => event.label)).toContain("إنشاء طلب شراء المادة");
    expect(journey.map(event => event.label)).toContain("صرف المواد للفني");
    expect(journey.find(event => event.label === "انتهاء الفرز والتصنيف")?.at).toBeNull();
  });
  it("counts one parent and its children in different units", () => {
    const data = fixture(); data.tickets = data.tickets.slice(0, 4);
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.new_reports).toBe(1);
    expect(report.counts.open_execution).toBe(1);
    expect(report.counts.completed_execution).toBe(2);
    expect(report.counts.organizing_reports).toBe(1);
    expect(report.metrics.organizing_reports[0]).toMatchObject({ childTotal: 3, childCompleted: 2 });
  });
  it.each(["closed", "requester_confirmed"])("excludes %s from all active execution counts", status => {
    const data = fixture(); data.tickets = [ticket(2, { status, priority: "critical", closedAt: NOW - HOUR })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.open_execution).toBe(0);
    expect(report.counts.aged_execution).toBe(0);
    expect(report.counts.critical_execution).toBe(0);
    expect(report.counts.waiting_material).toBe(0);
    expect(report.counts.completed_execution).toBe(1);
  });
  it("keeps closure credit and stops age after requester confirmation", () => {
    const data = fixture(); data.tickets = [ticket(2, { status: "requester_confirmed", closedAt: NOW - 70 * HOUR })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.metrics.completed_execution[0].ageHours).toBe(2);
    expect(report.metrics.completed_execution[0].waitHours).toBeNull();
  });
  it("keeps earlier open work while applying the period to completions", () => {
    const data = fixture(); data.tickets = [ticket(8, { createdAt: NOW - 90 * 24 * HOUR }), ticket(9, { status: "closed", closedAt: Date.parse("2026-09-30T12:00:00+03:00") })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.open_execution).toBe(1);
    expect(report.counts.completed_execution).toBe(0);
    expect(report.counts.new_reports).toBe(1);
  });
  it("does not invent a missing closure date", () => {
    const data = fixture(); data.tickets = [ticket(8, { status: "closed" })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.completed_execution).toBe(0);
    expect(report.counts.open_execution).toBe(0);
    expect(report.missingClosedDates).toBe(1);
  });
  it("separates waiting for another organization from time inside the manager's department", () => {
    const report = buildDashboard(fixture(), FILTERS, NOW);
    const general = report.managers.find(g => g.managerId === 10)!;
    const construction = report.managers.find(g => g.managerId === 11)!;
    expect(general.agedInside).toBe(0);
    expect(construction.agedInside).toBe(1);
    expect(report.metrics.open_execution.find(t => t.id === 4)?.waitOwner).toBe("mixed");
    expect(general.unknownWait).toBe(1);
  });
  it("does not charge unknown current-stage time to a manager", () => {
    const data = fixture(); data.tickets = [ticket(8)];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.managers[0]).toMatchObject({ agedInside: 0, unknownWait: 1 });
  });
  it("charges a known warehouse wait to waiting-elsewhere only", () => {
    const data = fixture(); data.tickets = [ticket(8, { status: "purchased" })]; data.orders = [];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.managers[0]).toMatchObject({ agedInside: 0, waitingElsewhere: 1 });
  });
  it("does not multiply a material ticket by needs or purchase links", () => {
    const data = fixture(); data.teamPurchaseLinks.push(...data.teamPurchaseLinks);
    expect(buildDashboard(data, FILTERS, NOW).counts.waiting_material).toBe(1);
  });
  it("uses canonical current-round team purchase links instead of old direct ticket links", () => {
    const data = fixture(); data.tickets = [ticket(4)];
    data.purchases = [purchase(1), purchase(2, { status: "approved" })];
    data.teamPurchaseLinks = [{ ticketId: 4, purchaseItemId: 2 }];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.metrics.open_execution[0]).toMatchObject({ waitOwner: "purchase", currentSince: null });
    expect(report.managers[0]).toMatchObject({ waitingElsewhere: 1, agedInside: 0 });
  });
  it("names the manager for team-result review, without declaring the ticket closed", () => {
    const data = fixture(); data.tickets = [ticket(4)]; data.teams[0].stage = "awaiting_review";
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.metrics.open_execution[0]).toMatchObject({ waitOwner: "maintenance", actorNames: ["مدير الصيانة"], actionStage: "team:awaiting_review" });
    data.teams[0].stage = "closed";
    expect(buildDashboard(data, FILTERS, NOW).counts.open_execution).toBe(1);
  });
  it("names the supervisor for path A final closure", () => {
    const data = fixture(); data.tickets = [ticket(8, { status: "ready_for_closure", maintenancePath: "A", supervisorId: 20 })];
    expect(buildDashboard(data, FILTERS, NOW).metrics.open_execution[0].actorNames).toEqual(["مندوب المشتريات"]);
  });
  it.each([
    ["pending_accounting", "accounting"], ["pending_management", "management"],
    ["pending_review", "maintenance"], ["pending_estimate", "purchase"], ["approved", "external"],
  ])("follows external-maintenance purchasing phase %s without inventing its start time", (status, owner) => {
    const data = fixture(); data.tickets = [ticket(4, { status: "out_for_repair" })]; data.teams = [];
    data.orders[0].status = status;
    data.externalJobs = [{ ticketId: 4, status: "purchase_cycle", purchaseOrderId: 100, delegateId: 20, createdAt: NOW - 80 * HOUR, gateExitApprovedAt: NOW - 75 * HOUR, warehousePreparedAt: null, delegateReadyForReturnAt: null, gateEntryApprovedAt: null, warehouseReceivedAt: null, handoverAt: null }];
    const row = buildDashboard(data, FILTERS, NOW).metrics.open_execution[0];
    expect(row).toMatchObject({ waitOwner: owner, currentSince: null, actionStage: "external:purchase_cycle" });
  });
  it("separates gate custody from maintenance and uses the actual reinstall recipient", () => {
    const data = fixture(); data.tickets = [ticket(8, { status: "out_for_repair", assignedToId: 10 })];
    data.externalJobs = [{ ticketId: 8, status: "waiting_gate_exit", delegateId: 20, actualRecipientId: 12, createdAt: NOW - 80 * HOUR, warehousePreparedAt: NOW - 60 * HOUR, gateExitApprovedAt: null, delegateReadyForReturnAt: null, gateEntryApprovedAt: null, warehouseReceivedAt: null, handoverAt: NOW - HOUR }];
    expect(buildDashboard(data, FILTERS, NOW).metrics.open_execution[0]).toMatchObject({ waitOwner: "gate", currentSince: NOW - 60 * HOUR });
    data.externalJobs[0].status = "delivered_for_reinstall";
    expect(buildDashboard(data, FILTERS, NOW).metrics.open_execution[0]).toMatchObject({ waitOwner: "maintenance", currentSince: NOW - HOUR, actorNames: ["فني الفريق"] });
    data.tickets[0].status = "closed"; data.tickets[0].closedAt = NOW - HOUR;
    expect(buildDashboard(data, FILTERS, NOW).metrics.completed_execution[0].waitOwner).toBe("finished");
  });
  it("attributes secondary legacy departments without a manager/department cross-product", () => {
    const data = fixture(); data.tickets = [ticket(8)];
    data.itemScopes = [{ ticketId: 8, department: "general", managerId: 10 }, { ticketId: 8, department: "construction", managerId: 11 }];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.open_execution).toBe(1);
    expect(report.managers).toHaveLength(2);
    expect(report.managers.every(m => m.agedInside === 0)).toBe(true);
    expect(dashboardDetails(report, "open_execution", 1, "construction:10").total).toBe(0);
    expect(dashboardDetails(report, "open_execution", 1, "construction:11").total).toBe(1);
  });
  it("filters site and department using item-level responsibility", () => {
    const data = fixture(); data.itemScopes = [{ ticketId: 7, department: "construction", managerId: 11 }];
    const report = buildDashboard(data, { ...FILTERS, siteId: 1, department: "construction" }, NOW);
    expect(report.counts.open_execution).toBe(2);
    expect(buildDashboard(data, { ...FILTERS, siteId: 2 }, NOW).counts.open_execution).toBe(0);
  });
  it("shows the recorded legacy location without inventing a site identifier", () => {
    const data = fixture(); data.tickets = [ticket(78, { siteId: null, locationDetail: "  منطقة الآلات المسجلة  " })];
    const row = buildDashboard(data, FILTERS, NOW).metrics.open_execution[0];
    expect(row).toMatchObject({ siteId: null, siteName: "منطقة الآلات المسجلة" });
    expect(buildDashboard(data, { ...FILTERS, siteId: 1 }, NOW).counts.open_execution).toBe(0);
  });
  it("prefers the site name and inherits a recorded parent location for children and linked purchases", () => {
    const data = fixture(); data.tickets[0].siteId = null; data.tickets[0].locationDetail = "موقع مسجل للرئيسي";
    data.tickets[3].siteId = null;
    data.orders[0].siteId = null;
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.metrics.open_execution.find(row => row.id === 4)?.siteName).toBe("موقع مسجل للرئيسي");
    expect(report.metrics.received_value[0].siteName).toBe("موقع مسجل للرئيسي");
    data.tickets[3].siteId = 1;
    expect(buildDashboard(data, FILTERS, NOW).metrics.open_execution.find(row => row.id === 4)?.siteName).toBe("الموقع الرئيسي");
  });
  it("counts only approved/funded items as ready to purchase and purchased items as in transit", () => {
    const data = fixture(); data.purchases = ["pending", "estimated", "approved", "funded", "purchased", "delivered_to_warehouse", "delivered_to_requester", "rejected", "cancelled", "purchase_cancelled"].map((status, index) => purchase(index + 1, { status }));
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.counts.purchase_pending).toBe(2);
    expect(report.counts.purchase_in_transit).toBe(1);
    expect(report.counts.purchase_received).toBe(2);
  });
  it("sums received actual costs exactly once and never substitutes estimates", () => {
    const data = fixture(); data.purchases = [purchase(1, { actualTotalCost: "0.10" }), purchase(2, { actualTotalCost: "0.20" }), purchase(1, { actualTotalCost: "0.10" }), purchase(3, { status: "approved", actualTotalCost: "900" }), purchase(4, { actualTotalCost: null })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.receivedValue).toBe(0.3);
    expect(report.counts.received_value).toBe(3);
    expect(report.missingCosts).toBe(1);
    expect(dashboardDetails(report, "received_value").receivedValue).toBe(0.3);
  });
  it.each(["-1", "garbage", "", "1.234", "Infinity"])("flags invalid actual cost %s", cost => {
    const data = fixture(); data.purchases = [purchase(1, { actualTotalCost: cost })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.receivedValue).toBe(0);
    expect(report.missingCosts).toBe(1);
  });
  it("keeps a documented zero distinct from a missing cost", () => {
    const data = fixture(); data.purchases = [purchase(1, { actualTotalCost: "0.00" })];
    expect(buildDashboard(data, FILTERS, NOW).missingCosts).toBe(0);
  });
  it("flags undated receipts and does not assign them to the current month", () => {
    const data = fixture(); data.purchases = [purchase(1, { receivedAt: null })];
    const report = buildDashboard(data, FILTERS, NOW);
    expect(report.receivedValue).toBe(0);
    expect(report.missingReceiptDates).toBe(1);
    expect(buildDashboard(data, { ...FILTERS, period: "all" }, NOW).receivedValue).toBe(50.1);
  });
  it("uses Riyadh midnight boundaries independent of process timezone", () => {
    const range = dashboardPeriod({ ...FILTERS, period: "custom", dateFrom: "2026-10-01", dateTo: "2026-10-01" }, NOW);
    expect(range.fromMs).toBe(Date.parse("2026-09-30T21:00:00Z"));
    expect(range.toMs).toBe(Date.parse("2026-10-01T21:00:00Z"));
    const data = fixture(); data.tickets = [ticket(8, { status: "closed", closedAt: range.fromMs }), ticket(9, { status: "closed", closedAt: range.toMs })];
    expect(buildDashboard(data, { ...FILTERS, period: "custom", dateFrom: "2026-10-01", dateTo: "2026-10-01" }, NOW).counts.completed_execution).toBe(1);
  });
  it.each([["2026-02-30", "2026-03-01"], ["2026-10-14", "2026-10-13"], [undefined, undefined]])("rejects invalid custom dates", (dateFrom, dateTo) => {
    expect(() => dashboardPeriod({ ...FILTERS, period: "custom", dateFrom, dateTo }, NOW)).toThrow();
  });
  it("keeps each count and its detail predicate identical", () => {
    const report = buildDashboard(fixture(), FILTERS, NOW);
    for (const metric of DASHBOARD_METRICS) expect(dashboardDetails(report, metric).total).toBe(report.counts[metric]);
    for (const manager of report.managers) {
      expect(dashboardDetails(report, "open_execution", 1, manager.key).total).toBe(manager.open);
      expect(dashboardDetails(report, "completed_execution", 1, manager.key).total).toBe(manager.completed);
      expect(dashboardDetails(report, "open_execution", 1, manager.key, "waiting_elsewhere").total).toBe(manager.waitingElsewhere);
      expect(dashboardDetails(report, "open_execution", 1, manager.key, "aged_inside").total).toBe(manager.agedInside);
      expect(dashboardDetails(report, "open_execution", 1, manager.key, "unknown_wait").total).toBe(manager.unknownWait);
    }
  });
  it("paginates details while preserving the real total", () => {
    const data = fixture(); data.tickets = Array.from({ length: 43 }, (_, index) => ticket(index + 100));
    const report = buildDashboard(data, FILTERS, NOW);
    expect(dashboardDetails(report, "open_execution", 3)).toMatchObject({ total: 43, pageSize: 20 });
    expect(dashboardDetails(report, "open_execution", 3).rows).toHaveLength(3);
    expect(dashboardSummary(report).followupRows).toHaveLength(10);
  });
});
