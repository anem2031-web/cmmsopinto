import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignedTeamTicket } from "../../shared/maintenance-team-tickets/assignment";
import { localizeTeamTicketQueue, queueTeamTicketTranslations } from "../maintenance-team-tickets/ticket-translations";
import { TicketTeamAssignmentService } from "../maintenance-team-tickets/assignment/service";
import { createTicketTeamAssignmentRouter } from "../routers/maintenance-teams/assignment.router";
import { router } from "../routers/_shared/procedures";

const mocks = vi.hoisted(() => ({ queueTranslation: vi.fn(), getBatchTranslations: vi.fn() }));
vi.mock("../services/translation/translationEngine", () => mocks);
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const ticket = {
  ticketId: 11, assignmentId: 33, ticketNumber: "MT-2026-00566-01",
  title: "إصلاح المحرك", description: "Check the power cable",
  teamId: 3, teamName: "فريق الكهرباء", warehouseName: "مخزن الكهرباء",
  stage: "action_required", sourceStatus: "under_inspection", siteName: "الموقع", sectionName: "القسم",
} satisfies AssignedTeamTicket;

describe("team ticket translations", () => {
  it("queues each source language for the child ticket and ignores empty fields", async () => {
    await queueTeamTicketTranslations({ ...ticket, userId: 7 });
    expect(mocks.queueTranslation.mock.calls.map(([request]) => request)).toEqual([
      { entityType: "TICKET", entityId: 11, fields: [{ fieldName: "title", text: ticket.title }], sourceLanguage: "ar", userId: 7 },
      { entityType: "TICKET", entityId: 11, fields: [{ fieldName: "description", text: ticket.description }], sourceLanguage: "en", userId: 7 },
    ]);

    mocks.queueTranslation.mockClear();
    await queueTeamTicketTranslations({ ticketId: 12, userId: 7, title: "روشنی چیک کریں", description: " " });
    expect(mocks.queueTranslation).toHaveBeenCalledOnce();
    expect(mocks.queueTranslation).toHaveBeenCalledWith(expect.objectContaining({ entityId: 12, sourceLanguage: "ur" }));
  });

  it("reads one batch for distinct scoped ticket IDs and falls back per field", async () => {
    mocks.getBatchTranslations.mockResolvedValue({
      11: { title: { text: "موٹر کی مرمت", status: "completed" }, description: { text: null, status: "pending" } },
      12: { title: { text: null, status: "not_found" }, description: { text: "تار چیک کریں", status: "approved" } },
    });
    const duplicate = { ...ticket, assignmentId: 34 };
    const second = { ...ticket, ticketId: 12, assignmentId: 35 };
    const result = await localizeTeamTicketQueue([ticket, duplicate, second], "ur");
    expect(mocks.getBatchTranslations).toHaveBeenCalledTimes(1);
    expect(mocks.getBatchTranslations).toHaveBeenCalledWith("TICKET", [11, 12], "ur", ["title", "description"]);
    expect(result).toEqual([
      { ...ticket, title: "موٹر کی مرمت" },
      { ...duplicate, title: "موٹر کی مرمت" },
      { ...second, description: "تار چیک کریں" },
    ]);
    expect(ticket.title).toBe("إصلاح المحرك");
  });

  it("does not read translations when the technician has no scoped tickets", async () => {
    expect(await localizeTeamTicketQueue([], "en")).toEqual([]);
    expect(mocks.getBatchTranslations).not.toHaveBeenCalled();
  });

  it("localizes the ticket detail for permitted roles through the existing queue", async () => {
    const repository = {
      queue: vi.fn().mockResolvedValue([ticket]),
      candidates: vi.fn(),
      transaction: vi.fn(),
    };
    const app = router({
      ticketTeamAssignments: createTicketTeamAssignmentRouter(new TicketTeamAssignmentService(repository)),
    });
    const caller = (role: string) =>
      app.createCaller({ user: { id: 7, role, isActive: 1 } } as Parameters<typeof app.createCaller>[0]);

    mocks.getBatchTranslations.mockResolvedValue({
      11: {
        title: { text: "Motor repair", status: "completed" },
        description: { text: "Inspect the power cable", status: "completed" },
      },
    });
    for (const role of ["technician", "general_maintenance_manager", "admin"]) {
      expect(await caller(role).ticketTeamAssignments.queue({ language: "en" })).toEqual([
        { ...ticket, title: "Motor repair", description: "Inspect the power cable" },
      ]);
    }

    expect(await caller("admin").ticketTeamAssignments.queue()).toEqual([ticket]);
    expect(mocks.getBatchTranslations).toHaveBeenCalledTimes(3);

    repository.queue.mockClear();
    mocks.getBatchTranslations.mockClear();
    await expect(caller("accountant").ticketTeamAssignments.queue({ language: "en" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.queue).not.toHaveBeenCalled();
    expect(mocks.getBatchTranslations).not.toHaveBeenCalled();
  });
});
