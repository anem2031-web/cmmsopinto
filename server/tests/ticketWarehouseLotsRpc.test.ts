import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  calls: [] as any[],
  reads: [] as any[],
  assignment: 1,
  actorId: 20,
  active: true,
  stage: "waiting_material",
  error: null as Error | null,
  lots: [{ lotId: 1, quantity: 6, unit: "حبة" }],
}));
vi.mock("../_core/db/client", () => ({
  getDb: async () => {
    throw Error("Live DB forbidden");
  },
}));
vi.mock("../routers/maintenance-teams/execution.repository", () => ({
  selectRows: vi.fn(),
  executionService: () => {
    throw Error("Use isolated service");
  },
  SqlExecutionStore: class {
    constructor(
      private assignmentId: number,
      private actor: any
    ) {}
    async transaction(work: any) {
      state.reads.push([this.assignmentId, this.actor.id]);
      if (state.error) throw state.error;
      if (
        this.assignmentId !== state.assignment ||
        !state.active ||
        this.actor.id !== state.actorId
      )
        throw Error("Scope denied");
      return work(
        {
          assignments: [
            {
              id: state.assignment,
              warehouseId: 5,
              materialRound: 1,
              stage: state.stage,
            },
          ],
          needs: [{ id: 11, assignmentId: state.assignment, round: 1 }],
        },
        {
          mainWarehouseId: async () => 1,
          issueLots: async (needId: number, warehouseId: number) => {
            state.calls.push([needId, warehouseId]);
            return state.lots;
          },
        }
      );
    }
  },
}));
import { router } from "../routers/_shared/procedures";
import { createTicketTeamExecutionRouter } from "../routers/maintenance-teams/execution.router";
const app = router({
  ticketTeamExecution: createTicketTeamExecutionRouter(
    (assignmentId, actor) =>
      ({
        read: async () => {
          if (state.error) throw state.error;
          if (
            !actor.active ||
            assignmentId !== state.assignment ||
            actor.id !== state.actorId
          )
            throw Error("Scope denied");
          return {};
        },
      }) as any
  ),
});
function caller(role = "warehouse", id = 20, isActive = 1) {
  const actor = { id, role, isActive };
  return app.createCaller({
    user: actor,
    authenticatedUser: actor,
    req: {},
    res: {},
  } as any).ticketTeamExecution;
}
beforeEach(() => {
  state.calls = [];
  state.reads = [];
  state.assignment = 1;
  state.actorId = 20;
  state.active = true;
  state.stage = "waiting_material";
  state.error = null;
});
describe("Explicit warehouse lot read boundary", () => {
  it.each(["warehouse", "admin", "owner"])(
    "allows existing %s capability with current record scope",
    async role => {
      expect(
        await caller(role).balances({ assignmentId: 1, issueNeedId: 11 })
      ).toEqual([{ needId: 11, branch: 0, main: 0, lots: state.lots }]);
      expect(state.calls).toEqual([[11, 5]]);
    }
  );
  it.each(["technician", "it_member", "delegate", "observer", "accountant"])(
    "denies direct lot enumeration by %s",
    async role => {
      await expect(
        caller(role).balances({ assignmentId: 1, issueNeedId: 11 })
      ).rejects.toThrow();
      expect(state.calls).toEqual([]);
    }
  );
  it("denies foreign/missing parents and foreign needs, then allows an independent valid read", async () => {
    await expect(
      caller().balances({ assignmentId: 999, issueNeedId: 11 })
    ).rejects.toThrow();
    await expect(
      caller().balances({ assignmentId: 1, issueNeedId: 99 })
    ).rejects.toThrow();
    expect(state.calls).toEqual([]);
    await caller().balances({ assignmentId: 1, issueNeedId: 11 });
    expect(state.calls).toHaveLength(1);
    state.active = false;
    await expect(
      caller().balances({ assignmentId: 1, issueNeedId: 11 })
    ).rejects.toThrow();
    expect(state.calls).toHaveLength(1);
  });
  it("rechecks the stage and propagates infrastructure failures without returning empty lots", async () => {
    state.stage = "completed";
    await expect(
      caller().balances({ assignmentId: 1, issueNeedId: 11 })
    ).rejects.toThrow();
    state.stage = "waiting_material";
    state.error = Error("infrastructure unavailable");
    await expect(
      caller().balances({ assignmentId: 1, issueNeedId: 11 })
    ).rejects.toThrow("infrastructure unavailable");
    expect(state.calls).toEqual([]);
  });
});
