import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const current = vi.hoisted(() => ({ db: null as any }));
vi.mock("../_core/db/client", () => ({ getDb: async () => current.db }));
vi.mock("../_core/db", () => ({
  getTicketById: async (id: number) => ({ id }),
}));
vi.mock("../routers/tickets/tickets.access", () => ({
  assertTicketReadable: async () => {
    throw new TRPCError({ code: "FORBIDDEN" });
  },
}));
vi.mock("../routers/uploads/attachments.access", () => ({
  assertCanAccessAttachments: async () => {
    throw new TRPCError({ code: "FORBIDDEN" });
  },
}));
import {
  loadWarehouseMaterialTicketScope,
  readWarehouseMaterialTicket,
  canReadWarehouseMaterialTicketMedia,
} from "../maintenance-team-tickets/warehouse-ticket-reader";
import {
  assertMediaAccess,
  mediaAccessPort,
} from "../_core/authz/media-access";
import { createTicketTeamExecutionRouter } from "../routers/maintenance-teams/execution.router";
import { router } from "../_core/trpc";
import {
  businessRpcAllowed,
  businessPageAllowed,
} from "../../shared/business-role-policy";
const closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach(close => close());
  current.db = null;
});
const actor = (role = "warehouse", id = 9, isActive = 1) => ({
  role,
  id,
  isActive,
});
const url = (name: string) => `/api/media?key=cmms/uploads/${name}`;
function fixture() {
  const memory = new DatabaseSync(":memory:");
  closes.push(() => memory.close());
  memory.exec(`CREATE TABLE users(id INTEGER,role TEXT,isActive INTEGER);
    CREATE TABLE tickets(id INTEGER,parentTicketId INTEGER,sourceTaskId INTEGER,workflowModel TEXT,beforePhotoUrl TEXT,title TEXT,description TEXT,status TEXT,priority TEXT,createdAt TEXT,afterPhotoUrl TEXT);
    CREATE TABLE maintenance_teams(id INTEGER,name TEXT);
    CREATE TABLE ticket_items(id INTEGER,ticketId INTEGER);
    CREATE TABLE ticket_team_assignments(id INTEGER,ticketId INTEGER,ticketItemId INTEGER,teamId INTEGER,ticketNumber TEXT,siteId INTEGER,sectionId INTEGER);
    CREATE TABLE ticket_team_material_needs(assignmentId INTEGER);
    CREATE TABLE ticket_tasks(id INTEGER,ticketId INTEGER,convertedTicketId INTEGER);
    CREATE TABLE sites(id INTEGER,name TEXT);
    CREATE TABLE sections(id INTEGER,name TEXT);
    CREATE TABLE attachments(id INTEGER,entityType TEXT,entityId INTEGER,fileUrl TEXT,fileName TEXT,mimeType TEXT);
    INSERT INTO users VALUES(9,'warehouse',1),(10,'admin',1);
    INSERT INTO sites VALUES(1,'Site'); INSERT INTO sections VALUES(1,'Section');
    INSERT INTO maintenance_teams VALUES(1,'Team');
    INSERT INTO tickets VALUES(100,NULL,NULL,'department_tasks',NULL,'Original','Original report','assigned','high','2026-11-03',NULL),
      (200,100,10,'sub_ticket',NULL,'Repair light','Written report','in_progress','high','2026-11-03',NULL),
      (201,100,11,'sub_ticket',NULL,'Foreign','Not material-related','in_progress','high','2026-11-03',NULL);
    INSERT INTO ticket_items VALUES(1,200),(2,201);
    INSERT INTO ticket_team_assignments VALUES(1,200,1,1,'MT-TEST-01',1,1),(2,201,2,1,'MT-TEST-02',1,1),(3,999,99,1,'MISSING',1,1);
    INSERT INTO ticket_team_material_needs VALUES(1),(3);
    INSERT INTO ticket_tasks VALUES(10,100,200),(11,100,201);`);
  memory
    .prepare("UPDATE tickets SET beforePhotoUrl=? WHERE id=100")
    .run(url("original.jpg"));
  memory
    .prepare("UPDATE tickets SET beforePhotoUrl=?,afterPhotoUrl=? WHERE id=200")
    .run(url("child.jpg"), url("after.jpg"));
  const add = memory.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?)");
  [
    [1, "ticket", 100, url("original.mp4"), "original.mp4", "video/mp4"],
    [2, "ticket", 200, url("child.png"), "child.png", "image/png"],
    [3, "ticket", 100, url("secret.pdf"), "secret.pdf", "application/pdf"],
    [4, "ticket", 201, url("foreign.jpg"), "foreign.jpg", "image/jpeg"],
  ].forEach(row => add.run(...row));
  const queries: any[] = [];
  const dialect = new MySqlDialect();
  const db = {
    execute: async (statement: any) => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (!query.sql.trim().startsWith("SELECT"))
        throw Error("Writes forbidden");
      return [memory.prepare(query.sql).all(...query.params), []];
    },
  };
  current.db = db;
  return { memory, queries, db };
}
describe("Warehouse material-linked ticket, isolated real SQL", () => {
  it("returns a read-only projection and report images/video only for the linked ticket", async () => {
    const f = fixture(),
      result = await readWarehouseMaterialTicket(f.db, actor(), 200);
    expect(result).toMatchObject({
      id: 200,
      title: "Repair light",
      description: "Written report",
      siteName: "Site",
      sectionName: "Section",
      teamName: "Team",
    });
    expect(result.reportMedia.map(item => item.url)).toEqual([
      url("original.jpg"),
      url("original.mp4"),
      url("child.png"),
    ]);
    for (const field of [
      "parentTicketId",
      "afterPhotoUrl",
      "financialApprovals",
      "signatureUrl",
    ])
      expect(result).not.toHaveProperty(field);
    expect(f.queries).toHaveLength(2);
  });
  it("keeps parent, unrelated, missing-ticket and missing-item decisions independent", async () => {
    const f = fixture();
    const scope = await loadWarehouseMaterialTicketScope(
      f.db,
      actor(),
      [200, 201, 100, 999]
    );
    expect([...scope.keys()]).toEqual([200]);
    for (const id of [201, 100, 999])
      await expect(
        readWarehouseMaterialTicket(f.db, actor(), id)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("DELETE FROM ticket_items WHERE id=1");
    await expect(
      readWarehouseMaterialTicket(f.db, actor(), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([
    "accountant",
    "senior_management",
    "admin",
    "owner",
    "technician",
    "it_member",
    "it_manager",
    "operator",
    "observer",
  ])("does not add this RPC reader to %s", async role => {
    const f = fixture();
    await expect(
      readWarehouseMaterialTicket(f.db, actor(role), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(0);
  });
  it("rechecks active identity and the material link on consecutive requests", async () => {
    const f = fixture();
    await readWarehouseMaterialTicket(f.db, actor(), 200);
    await expect(
      readWarehouseMaterialTicket(f.db, actor("warehouse", 10), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=9");
    await expect(
      readWarehouseMaterialTicket(f.db, actor(), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=9");
    await readWarehouseMaterialTicket(f.db, actor(), 200);
    f.memory.exec(
      "DELETE FROM ticket_team_material_needs WHERE assignmentId=1"
    );
    await expect(
      readWarehouseMaterialTicket(f.db, actor(), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("bounds large ID lists by 500 and deduplicates repeated parents without per-row reads", async () => {
    const f = fixture();
    await loadWarehouseMaterialTicketScope(
      f.db,
      actor(),
      Array(1200).fill(200)
    );
    expect(f.queries).toHaveLength(1);
    f.queries.length = 0;
    await loadWarehouseMaterialTicketScope(
      f.db,
      actor(),
      Array.from({ length: 1001 }, (_, n) => n + 1)
    );
    expect(f.queries).toHaveLength(3);
    expect(f.queries.every(query => query.params.length <= 501)).toBe(true);
  });
  it("denies arbitrary IDs, inactive actors, and infrastructure failures without granting access", async () => {
    const f = fixture();
    for (const id of [0, -1, NaN, 1.2])
      await expect(
        readWarehouseMaterialTicket(f.db, actor(), id)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readWarehouseMaterialTicket(f.db, actor("warehouse", 9, 0), 200)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readWarehouseMaterialTicket(
        {
          execute: async () => {
            throw Error("offline");
          },
        },
        actor(),
        200
      )
    ).rejects.toThrow("offline");
    await expect(
      readWarehouseMaterialTicket({ execute: async () => null }, actor(), 200)
    ).rejects.toThrow("تعذر التحقق");
  });
  it("does not expose parent attachments after a broken task-to-ticket link", async () => {
    const f = fixture();
    f.memory.exec("UPDATE ticket_tasks SET convertedTicketId=999 WHERE id=10");
    expect(
      (await readWarehouseMaterialTicket(f.db, actor(), 200)).reportMedia.map(
        item => item.url
      )
    ).toEqual([url("child.jpg"), url("child.png")]);
  });
  it("uses a fresh exact-media check and never grants PDFs, after photos, signatures or unrelated ticket files", async () => {
    const f = fixture();
    const port = (parentId: number) => ({
      references: async () => [
        { kind: "attachment", id: 1, parentId, entityType: "ticket" },
      ],
      authorize: mediaAccessPort.authorize,
    });
    await expect(
      assertMediaAccess(actor(), "cmms/uploads/original.mp4", port(100))
    ).resolves.toBe("cmms/uploads/original.mp4");
    for (const [id, key] of [
      [100, "secret.pdf"],
      [200, "after.jpg"],
      [201, "foreign.jpg"],
    ] as const)
      await expect(
        assertMediaAccess(actor(), `cmms/uploads/${key}`, port(id))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assertMediaAccess(actor(), "cmms/uploads/signature.png", {
        references: async () => [{ kind: "signature", id: 10, ownerId: 10 }],
        authorize: mediaAccessPort.authorize,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("DELETE FROM ticket_team_material_needs");
    await expect(
      assertMediaAccess(actor(), "cmms/uploads/original.mp4", port(100))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await canReadWarehouseMaterialTicketMedia(
        f.db,
        actor("technician"),
        100,
        "cmms/uploads/original.mp4"
      )
    ).toBe(false);
  });
  it("grants only the exact query centrally, and direct RPC calls still enforce role, activity and record scope", async () => {
    const f = fixture();
    const read = vi.fn((user: any, id: number) =>
      readWarehouseMaterialTicket(f.db, user, id)
    );
    const factory = vi.fn(() => {
      throw Error("No execution service or writer is used");
    });
    const root = router({
      ticketTeamExecution: createTicketTeamExecutionRouter(
        factory as any,
        undefined,
        undefined,
        read
      ),
    });
    const caller = (user: any) =>
      root.createCaller({ user, req: { headers: {} }, res: {} } as any);
    expect(
      businessRpcAllowed(
        actor(),
        "query",
        "ticketTeamExecution.warehouseTicket"
      )
    ).toBe(true);
    expect(
      businessRpcAllowed(
        actor(),
        "mutation",
        "ticketTeamExecution.warehouseTicket"
      )
    ).toBe(false);
    expect(businessRpcAllowed(actor(), "mutation", "tickets.update")).toBe(
      false
    );
    expect(businessPageAllowed("warehouse", "/tickets/200")).toBe(true);
    expect(businessPageAllowed("warehouse", "/tickets")).toBe(false);
    expect(
      (
        await caller(actor()).ticketTeamExecution.warehouseTicket({
          ticketId: 200,
        })
      ).id
    ).toBe(200);
    await expect(
      caller(actor()).ticketTeamExecution.warehouseTicket({ ticketId: 201 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of [
      "accountant",
      "senior_management",
      "technician",
      "it_member",
      "owner",
      "admin",
      "observer",
    ]) {
      await expect(
        caller(actor(role)).ticketTeamExecution.warehouseTicket({
          ticketId: 200,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      caller(actor("warehouse", 9, 0)).ticketTeamExecution.warehouseTicket({
        ticketId: 200,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(factory).not.toHaveBeenCalled();
  });
});
