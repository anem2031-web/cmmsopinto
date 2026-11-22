import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock("./translate-title", () => ({ translatePmv2TaskTitle: fake.translate }));
vi.mock("../checklists/service", () => ({ Pmv2ChecklistServiceError: class extends Error {}, pmv2ChecklistService: {} }));
import { router } from "../../_core/trpc";
import { pmv2ChecklistsRouter } from "../../routers/pmv2/checklists";
const api = router({ pmv2: router({ checklists: pmv2ChecklistsRouter }) });
const caller = (role: string, isActive = 1, actualRole = role) => {
  const user = { id: 42, role, isActive };
  return api.createCaller({ user, authenticatedUser: { ...user, role: actualRole }, req: { ip: "127.0.0.1", get: () => undefined } } as any).pmv2.checklists.items;
};
beforeEach(() => { fake.translate.mockReset(); fake.translate.mockResolvedValue({ en: "Inspection", ur: "معائنہ" }); });
describe("PMV2 translation preview authorization", () => {
  it.each(["owner", "admin", "maintenance_manager", "general_maintenance_manager"])("allows active %s", async role => {
    await expect(caller(role).translateTitle({ title: "فحص" })).resolves.toEqual({ en: "Inspection", ur: "معائنہ" });
    expect(fake.translate).toHaveBeenCalledWith("فحص");
  });
  it.each(["technician", "warehouse", "delegate", "senior_management", "observer"])("denies %s", async role => {
    await expect(caller(role).translateTitle({ title: "فحص" })).rejects.toThrow();
    expect(fake.translate).not.toHaveBeenCalled();
  });
  it("denies inactive accounts and rejects observer impersonation", async () => {
    await expect(caller("owner", 0).translateTitle({ title: "فحص" })).rejects.toThrow();
    await expect(caller("admin", 1, "observer").translateTitle({ title: "فحص" })).rejects.toThrow();
    expect(fake.translate).not.toHaveBeenCalled();
  });
  it("does not expose translator failures", async () => {
    fake.translate.mockRejectedValue(new Error("secret internal error"));
    await expect(caller("owner").translateTitle({ title: "فحص" })).rejects.toThrow("تعذرت الترجمة");
  });
});
