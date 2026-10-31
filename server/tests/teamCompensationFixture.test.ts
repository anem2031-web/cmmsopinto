import { describe, expect, it } from "vitest";
import { completeTeamCompensationNeed, continueTeamCompensationSource } from "../../tools/runtime-uat/team-compensation-api";

describe("resumable team trial source through authenticated RPC callbacks", () => {
  it.each(["provide", "receive", "resumeItem", "outcome", "returnMaterial"])("resumes completion after %s committed but its response was lost", async fault => {
    const state: any = { assignments: [{ id: 10, ticketId: 11, ticketItemId: 12, teamId: 2, materialRound: 1, stage: "waiting_material", revision: 1 }],
      needs: [{ id: 66, assignmentId: 10, catalogItemId: 90, name: "الأصل", unit: "قطعة", requested: 4, round: 1, used: null }],
      deliveries: [], returns: [], supplies: [], actions: [
        { assignmentId: 10, actorId: 1, kind: "execution_started", note: '{"version":1,"visitKey":"trial"}', revision: 0, at: "now" },
        { assignmentId: 10, actorId: 1, kind: "needs_material", note: "احتياج", revision: 1, at: "now" },
      ] };
    const counts = new Map<string, number>();
    let branch = 0, lost = false, proof: any = {};
    const rpc = {
      query: async (path: string) => {
        if (path === "auth.me") return { id: 1, role: "owner" };
        if (path === "ticketTeamExecution.details") return structuredClone(state);
        if (path === "ticketTeamExecution.balances") return [{ needId: 66, branch, main: branch ? 0 : 4 }];
        throw Error(path);
      },
      mutate: async (path: string, raw?: unknown) => {
        const input = raw as any, action = path.split(".").at(-1)!;
        counts.set(action, (counts.get(action) ?? 0) + 1);
        const a = state.assignments[0];
        if (action === "prepareSupply") return { replacementFulfillment: true, revision: a.revision };
        if (action === "provide") { branch = 4; state.supplies.push({ id: 71, kind: "transfer", sourceId: 72, needId: 66, quantity: 6, originalEquivalent: 4, status: "received" }); }
        else if (action === "receive") {
          expect(branch).toBe(4); branch = 0;
          state.deliveries.push({ id: 81, needId: 66, deliveryId: 91, deliveryNumber: "DLV-ACTUAL", lotId: 14, quantity: 6, originalEquivalent: 4,
            replacementPlanId: 9, replacementName: "البديل", physicalUnit: "متر", used: null, returned: 0 }); a.stage = "ready_to_repair";
        } else if (action === "resumeItem") state.actions.push({ assignmentId: 10, actorId: 1, kind: "execution_resumed", note: '{"version":1,"visitKey":"trial"}', revision: a.revision + 1, at: "now" });
        else if (action === "outcome") {
          expect(input.physicalUsages).toEqual([{ deliveryId: 91, used: 5 }]); state.deliveries[0].used = 5; a.stage = "awaiting_review";
          state.actions.push({ assignmentId: 10, actorId: 1, kind: "fixed", note: "تم", revision: a.revision + 1, at: "now" });
        } else if (action === "returnMaterial") { expect(input.allocations).toEqual([{ lotId: 14, quantity: 1 }]); state.deliveries[0].returned = 1; state.returns.push({ id: 99, quantity: 1 }); }
        else throw Error(path);
        a.revision++;
        if (action === fault && !lost) { lost = true; throw Error("response lost after commit"); }
        return { revision: a.revision };
      },
    };
    const options = () => ({ resume: proof, checkpoint: async (_stage: string, ids: Record<string, unknown>) => { proof = structuredClone(ids); } });
    await expect(completeTeamCompensationNeed(rpc, { assignmentId: 10, needId: 66 }, async () => {}, true, options())).rejects.toThrow("response lost");
    const result = await completeTeamCompensationNeed(rpc, { assignmentId: 10, needId: 66 }, async () => {}, true, options());
    expect(result.originalNeed).toMatchObject({ catalogItemId: 90, requested: 4, name: "الأصل", used: null });
    expect(result.actualDeliveries[0]).toMatchObject({ quantity: 6, used: 5, returned: 1 });
    for (const action of ["provide", "receive", "resumeItem", "outcome", "returnMaterial"]) expect(counts.get(action)).toBe(1);
    const snapshot = [...counts];
    await completeTeamCompensationNeed(rpc, { assignmentId: 10, needId: 66 }, async () => {}, true, options());
    expect([...counts]).toEqual(snapshot);
  });
  it("reuses the same need and source PO after an interrupted result without another mutation", async () => {
    const state: any = { assignments: [{ id: 10, ticketId: 11, ticketItemId: 12, teamId: 2, materialRound: 1, stage: "action_required", revision: 0 }],
      needs: [], supplies: [], actions: [{ assignmentId: 10, actorId: 1, kind: "execution_protocol", note: '{"version":1}', revision: 0 }] };
    const writes: string[] = [], a = state.assignments[0];
    const rpc = {
      query: async (path: string) => {
        if (path === "auth.me") return { id: 1, role: "owner" };
        if (path === "ticketTeamExecution.details") return structuredClone(state);
        if (path === "tickets.getById") return { id: 11, parentTicketId: 9 };
        if (path === "purchaseOrders.list") return [{ id: 77, poNumber: "PR-UAT" }];
        if (path === "purchaseOrders.getById") return { id: 77, poNumber: "PR-UAT", ticketId: 11, ticketItemId: 12, items: [{ id: 88, catalogItemId: 90, unit: "قطعة" }] };
        throw Error(path);
      },
      mutate: async (path: string, raw?: unknown) => {
        const input = raw as any; writes.push(path);
        if (path === "ticketTeamExecution.startItem") {
          state.actions.push({ assignmentId: 10, actorId: 1, kind: "execution_started", note: '{"version":1,"visitKey":"uat"}', revision: ++a.revision, at: "now" }); return {};
        }
        if (path === "ticketTeamExecution.request") {
          state.needs.push({ id: 66, assignmentId: 10, catalogItemId: 90, unit: "قطعة", requested: 4, round: 1 }); a.stage = "waiting_material"; a.revision++; return {};
        }
        if (path === "ticketTeamExecution.prepareSupply") return { assignmentId: 10, needId: 66, revision: a.revision, ticketItemId: 12, catalogItemId: 90, name: "صنف", quantity: 4, unit: "قطعة", location: { siteId: 1, sectionId: 2 } };
        if (path === "purchaseOrders.create") {
          expect(input.ticketTeam.operationKey).toBe("uat-team-source-po:10:66");
          state.supplies.push({ id: 55, needId: 66, kind: "purchase", sourceId: 88, sourceNumber: "PR-UAT", quantity: 4 });
          a.revision++; return { id: 77, poNumber: "PR-UAT" };
        }
        throw Error(path);
      },
    };
    const refs = { teamId: 2, managerId: 3, siteId: 1, sectionId: 2, categoryId: 2, photoUrl: "/api/media?key=trial", catalogItemId: 90, itemName: "صنف", unit: "قطعة", quantity: 4 };
    let checks = 0;
    const assertTrial = async () => { checks++; };
    const first = await continueTeamCompensationSource(rpc, { parentTicketId: 9, assignmentId: 10, ticketId: 11 }, refs, assertTrial);
    writes.length = 0;
    const second = await continueTeamCompensationSource(rpc, { parentTicketId: 9, assignmentId: 10, ticketId: 11 }, refs, assertTrial);
    expect(first.purchaseOrderId).toBe(77); expect(second.purchaseOrderId).toBe(77); expect(second.needId).toBe(66);
    expect(writes).toEqual([]); expect(checks).toBe(2);
  });
});
