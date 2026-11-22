import { describe, expect, it } from "vitest";
import { SimplifiedSetupService, type SetupActor, type SimplifiedSetupRepository, type SimplifiedSetupTx } from "./setup-service";
import type { PausedScheduleItem } from "../scheduler/pause-recovery";

const owner: SetupActor = { id: 7, role: "owner", isActive: 1 };
function fixture() {
  let now = "2026-11-01";
  let state: { plan: { id: number; state: "draft" | "active" | "paused"; pausedOn: string | null; teamId: number; siteId: number; sectionId: number } | null; items: PausedScheduleItem[]; events: string[]; recovered: any[] } = { plan: null, items: [], events: [], recovered: [] };
  let failAudit = false;
  const repository: SimplifiedSetupRepository = { async transaction(work) {
    const draft = structuredClone(state);
    const tx: SimplifiedSetupTx = {
      validateActor: async () => true,
      validateSiteSection: async (site, section) => site === 1 && section === 2,
      validateTeam: async team => team === 3,
      createDraft: async data => { draft.plan = { id: 4, state: "draft", pausedOn: null, teamId: data.teamId, siteId: data.siteId, sectionId: data.sectionId }; return 4; },
      lockPlan: async id => draft.plan?.id === id ? draft.plan : null,
      addItem: async (_planId, _item, schedule) => { const id = draft.items.length + 1; draft.items.push({ id, kind: schedule.kind, schedule }); return id; },
      revisePlan: async () => {},
      updateItem: async () => false,
      disableItem: async () => false,
      listItems: async () => draft.items,
      generate: async () => {},
      activate: async () => { draft.plan!.state = "active"; },
      pause: async (_id, date) => { draft.plan!.state = "paused"; draft.plan!.pausedOn = date; },
      resume: async (_id, _date, occurrences) => { draft.plan!.state = "active"; draft.plan!.pausedOn = null; draft.recovered.push(...occurrences); },
      audit: async event => { if (failAudit) throw new Error("audit failed"); draft.events.push(event.action); },
    };
    const result = await work(tx); state = draft; return result;
  } };
  return { service: new SimplifiedSetupService(repository, () => now), get state() { return state; }, setDate(date: string) { now = date; }, failAudit() { failAudit = true; } };
}
const base = { title: "فحص مطعم", siteId: 1, sectionId: 2, teamId: 3 };
const item = { titleAr: "فحص الكهرباء", titleEn: "Inspect electricity", titleUr: "بجلی کا معائنہ", recurrence: { kind: "weekly" as const, startDate: "2026-11-01", weekday: 3 } };

describe("simplified PMV2 setup service", () => {
  it("blocks unauthorized or inactive users before opening a transaction", async () => {
    const f = fixture();
    await expect(f.service.create({ ...owner, role: "technician" }, base)).rejects.toThrow();
    await expect(f.service.create({ ...owner, isActive: 0 }, base)).rejects.toThrow();
    expect(f.state.plan).toBeNull();
  });
  it("requires the selected section and team to be valid", async () => {
    const f = fixture();
    await expect(f.service.create(owner, { ...base, sectionId: 99 })).rejects.toThrow();
    await expect(f.service.create(owner, { ...base, teamId: 99 })).rejects.toThrow();
    expect(f.state.plan).toBeNull();
  });
  it("keeps a new plan a draft until at least one fully translated subtask exists", async () => {
    const f = fixture(); const { id } = await f.service.create(owner, base);
    await expect(f.service.addItem(owner, id, { ...item, titleEn: " " })).rejects.toThrow("عنوان المهمة بالإنجليزية");
    await expect(f.service.addItem(owner, id, { ...item, titleUr: "" })).rejects.toThrow("عنوان المهمة بالأوردو");
    expect(f.state.items).toHaveLength(0);
    await expect(f.service.activate(owner, id)).rejects.toThrow();
    await f.service.addItem(owner, id, item); await f.service.activate(owner, id);
    expect(f.state.plan?.state).toBe("active");
    await expect(f.service.addItem(owner, id, item)).resolves.toEqual({ id: 2 });
  });
  it("restores missed nondaily work before daily work and never repeats resume", async () => {
    const f = fixture(); const { id } = await f.service.create(owner, base);
    await f.service.addItem(owner, id, item);
    await f.service.addItem(owner, id, { ...item, recurrence: { kind: "daily", startDate: "2026-11-01" } });
    await f.service.activate(owner, id); await f.service.pause(owner, id);
    f.setDate("2026-11-07"); const result = await f.service.resume(owner, id);
    expect(result.occurrences.map(x => [x.itemId, x.scheduledDate])).toEqual([[1,"2026-11-04"],[2,"2026-11-07"]]);
    await expect(f.service.resume(owner, id)).rejects.toThrow();
    expect(f.state.recovered).toHaveLength(2);
  });
  it("rolls back the state transition and recovery when audit fails", async () => {
    const f = fixture(); const { id } = await f.service.create(owner, base);
    await f.service.addItem(owner, id, item); await f.service.activate(owner, id); await f.service.pause(owner, id);
    f.setDate("2026-11-07"); f.failAudit();
    await expect(f.service.resume(owner, id)).rejects.toThrow();
    expect(f.state.plan?.state).toBe("paused"); expect(f.state.recovered).toEqual([]);
  });
});
