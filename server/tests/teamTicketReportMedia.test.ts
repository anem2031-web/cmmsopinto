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
  loadTeamReportMedia,
  canReadTeamReportMedia,
} from "../maintenance-team-tickets/report-media";
import {
  assertMediaAccess,
  mediaAccessPort,
} from "../_core/authz/media-access";
import { SqlTicketTeamAssignmentRepository } from "../routers/maintenance-teams/assignment.repository";
const databases: any[] = [];
const actor = (role = "technician", id = 7, active = true) => ({
  role,
  id,
  active,
});
const url = (name: string) => `/api/media?key=cmms/uploads/${name}`;
function fixture() {
  const memory = new DatabaseSync(":memory:");
  databases.push(memory);
  memory.exec(`CREATE TABLE users(id INTEGER,role TEXT,isActive INTEGER);
    CREATE TABLE maintenance_teams(id INTEGER,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE tickets(id INTEGER,parentTicketId INTEGER,sourceTaskId INTEGER,workflowModel TEXT,beforePhotoUrl TEXT,assignedToId INTEGER,maintenanceResponsibleDepartment TEXT);
    CREATE TABLE ticket_items(id INTEGER,ticketId INTEGER);
    CREATE TABLE ticket_team_assignments(id INTEGER,ticketId INTEGER,ticketItemId INTEGER,teamId INTEGER);
    CREATE TABLE ticket_tasks(id INTEGER,ticketId INTEGER,convertedTicketId INTEGER);
    CREATE TABLE attachments(id INTEGER,entityType TEXT,entityId INTEGER,fileUrl TEXT,fileName TEXT,mimeType TEXT);
    INSERT INTO users VALUES(7,'technician',1),(8,'technician',1),(9,'warehouse',1),(10,'admin',1),(11,'it_manager',1),(12,'it_member',1);
    INSERT INTO maintenance_teams VALUES(1,1),(2,1);
    INSERT INTO maintenance_team_members VALUES(1,7,1),(2,8,1),(1,11,1),(1,12,1);
    INSERT INTO tickets VALUES(100,NULL,NULL,'department_tasks',NULL,NULL,'maintenance_report_department_general'),
      (200,100,10,'sub_ticket',NULL,NULL,'maintenance_report_department_general'),
      (201,100,11,'sub_ticket',NULL,NULL,'maintenance_report_department_general'),
      (202,100,12,'sub_ticket',NULL,11,'maintenance_report_department_it');
    INSERT INTO ticket_items VALUES(1,200),(2,201),(3,202);
    INSERT INTO ticket_team_assignments VALUES(1,200,1,1),(2,201,2,2),(3,202,3,1),(4,999,99,1);
    INSERT INTO ticket_tasks VALUES(10,100,200),(11,100,201),(12,100,202);`);
  memory
    .prepare(
      "UPDATE tickets SET beforePhotoUrl=? WHERE id IN (100,200,201,202)"
    )
    .run(url("main.jpg"));
  const insert = memory.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?)");
  [
    [1, "ticket", 100, url("main.jpg"), "main.jpg", "image/jpeg"],
    [2, "ticket", 100, url("report.mp4"), "report.mp4", "video/mp4"],
    [3, "ticket", 100, url("report.pdf"), "report.pdf", "application/pdf"],
    [4, "ticket", 200, url("child.png"), "child.png", "image/png"],
    [5, "ticket", 201, url("foreign.png"), "foreign.png", "image/png"],
    [6, "ticket", 100, url("fake.mp4"), "fake.mp4", "application/pdf"],
    [7, "purchase_order", 100, url("other.png"), "other.png", "image/png"],
  ].forEach(row => insert.run(...row));
  const calls: any[] = [];
  const dialect = new MySqlDialect();
  const db = {
    execute: async (query: any) => {
      const compiled = dialect.sqlToQuery(query);
      calls.push(compiled);
      return [memory.prepare(compiled.sql).all(...compiled.params)];
    },
  };
  current.db = db;
  return { memory, db, calls };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  current.db = null;
});
describe("Scoped report media for team-assigned ticket cards", () => {
  it("returns media through the existing assignment queue without changing assignment order or workflow state", async () => {
    const f = fixture();
    f.memory
      .exec(`ALTER TABLE ticket_team_assignments ADD COLUMN ticketNumber TEXT;
      ALTER TABLE ticket_team_assignments ADD COLUMN titleSnapshot TEXT;
      ALTER TABLE ticket_team_assignments ADD COLUMN warehouseId INTEGER;
      ALTER TABLE ticket_team_assignments ADD COLUMN stage TEXT;
      ALTER TABLE ticket_team_assignments ADD COLUMN siteId INTEGER;
      ALTER TABLE ticket_team_assignments ADD COLUMN sectionId INTEGER;
      ALTER TABLE ticket_team_assignments ADD COLUMN createdAt TEXT;
      ALTER TABLE maintenance_teams ADD COLUMN name TEXT;
      ALTER TABLE tickets ADD COLUMN status TEXT;
      ALTER TABLE tickets ADD COLUMN description TEXT;
      CREATE TABLE warehouses(id INTEGER,nameAr TEXT);
      CREATE TABLE sites(id INTEGER,name TEXT);
      CREATE TABLE sections(id INTEGER,name TEXT);
      CREATE TABLE ticket_team_actions(id INTEGER,assignmentId INTEGER,actorId INTEGER,kind TEXT,note TEXT,revision INTEGER,operationKey TEXT,createdAt TEXT);
      UPDATE ticket_team_assignments SET stage='action_required',ticketNumber='MT-TEST',createdAt='2026-11-02';`);
    const repository = new SqlTicketTeamAssignmentRepository(async () => ({
      db: f.db as any,
      tickets: {} as any,
    }));
    const result = await repository.queue(actor());
    expect(result.map(row => row.assignmentId)).toEqual([3, 1]);
    expect(result[0].reportMedia?.some(item => item.type === "video")).toBe(
      true
    );
    expect(result[0].executionInProgress).toBe(false);
    expect(f.calls).toHaveLength(4);
    expect(f.calls.every(call => /^SELECT/i.test(call.sql))).toBe(true);
  });
  it("includes the main photo and source report video, keeps child media, and excludes other children/documents", async () => {
    const f = fixture();
    const result = await loadTeamReportMedia(f.db, actor(), [
      { assignmentId: 1, ticketId: 200 },
      { assignmentId: 2, ticketId: 201 },
      { assignmentId: 4, ticketId: 999 },
    ]);
    expect(result.get(1)?.map(item => item.url)).toEqual([
      url("main.jpg"),
      url("report.mp4"),
      url("child.png"),
    ]);
    expect(result.has(2)).toBe(false);
    expect(result.has(4)).toBe(false);
    expect(f.calls).toHaveLength(2);
  });
  it("does not follow a fabricated source-task or mismatched assignment parent", async () => {
    const f = fixture();
    f.memory.exec("UPDATE ticket_tasks SET convertedTicketId=999 WHERE id=10");
    const result = await loadTeamReportMedia(f.db, actor(), [
      { assignmentId: 1, ticketId: 200 },
    ]);
    expect(result.get(1)?.map(item => item.url)).toEqual([
      url("main.jpg"),
      url("child.png"),
    ]);
    expect(
      (
        await loadTeamReportMedia(f.db, actor(), [
          { assignmentId: 1, ticketId: 999 },
        ])
      ).size
    ).toBe(0);
  });
  it("rechecks membership, team state and identity independently on consecutive reads", async () => {
    const f = fixture();
    const input = [{ assignmentId: 1, ticketId: 200 }];
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(1);
    f.memory.exec(
      "UPDATE maintenance_team_members SET isActive=0 WHERE userId=7"
    );
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(0);
    f.memory.exec(
      "UPDATE maintenance_team_members SET isActive=1 WHERE userId=7;UPDATE maintenance_teams SET isActive=0 WHERE id=1"
    );
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(0);
    f.memory.exec(
      "UPDATE maintenance_teams SET isActive=1 WHERE id=1;UPDATE users SET isActive=0 WHERE id=7"
    );
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(0);
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=7");
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(1);
  });
  it.each([
    "warehouse",
    "accountant",
    "operator",
    "construction_procurement_manager",
    "general_maintenance_manager",
  ])("does not add this team-only media capability for %s", async role => {
    const f = fixture();
    expect(
      (
        await loadTeamReportMedia(f.db, actor(role), [
          { assignmentId: 1, ticketId: 200 },
        ])
      ).size
    ).toBe(0);
    expect(f.calls).toEqual([]);
  });
  it("retains owner/admin access, but denies an inactive caller before database work", async () => {
    const f = fixture();
    expect(
      (
        await loadTeamReportMedia(f.db, actor("admin", 10), [
          { assignmentId: 2, ticketId: 201 },
        ])
      ).has(2)
    ).toBe(true);
    f.calls.length = 0;
    expect(
      (
        await loadTeamReportMedia(f.db, actor("admin", 10, false), [
          { assignmentId: 2, ticketId: 201 },
        ])
      ).size
    ).toBe(0);
    expect(f.calls).toEqual([]);
  });
  it("IT media remains limited to the exact assigned IT member/manager", async () => {
    const f = fixture();
    const items = [
      { assignmentId: 3, ticketId: 202 },
      { assignmentId: 1, ticketId: 200 },
    ];
    expect(
      Array.from(
        (await loadTeamReportMedia(f.db, actor("it_manager", 11), items)).keys()
      )
    ).toEqual([3]);
    expect(
      (await loadTeamReportMedia(f.db, actor("it_member", 12), items)).size
    ).toBe(0);
    f.memory.exec("UPDATE tickets SET assignedToId=12 WHERE id=202");
    expect(
      Array.from(
        (await loadTeamReportMedia(f.db, actor("it_member", 12), items)).keys()
      )
    ).toEqual([3]);
  });
  it("deduplicates repeated assignments/parents and bounds1001distinct assignments by500-ID chunks", async () => {
    const f = fixture();
    const input = [{ assignmentId: 1, ticketId: 200 }];
    await loadTeamReportMedia(f.db, actor(), Array(1200).fill(input[0]));
    expect(f.calls).toHaveLength(2);
    f.calls.length = 0;
    const insert = f.memory.prepare(
      "INSERT INTO ticket_team_assignments VALUES(?,200,1,1)"
    );
    for (let id = 10; id < 1010; id++) {
      insert.run(id);
      input.push({ assignmentId: id, ticketId: 200 });
    }
    expect((await loadTeamReportMedia(f.db, actor(), input)).size).toBe(1001);
    expect(f.calls).toHaveLength(4);
    expect(
      f.calls.filter(call => call.sql.includes("FROM attachments"))[0].params
    ).toEqual([200, 100]);
    expect(f.calls.slice(0, 3).every(call => call.params.length <= 504)).toBe(
      true
    );
  });
  it("propagates infrastructure failures instead of pretending the ticket has no media", async () => {
    await expect(
      loadTeamReportMedia(
        {
          execute: async () => {
            throw Error("DB unavailable");
          },
        },
        actor(),
        [{ assignmentId: 1, ticketId: 200 }]
      )
    ).rejects.toThrow("DB unavailable");
  });
  it("rechecks the real media proxy boundary for source-video reads and never grants PDFs or unrelated keys", async () => {
    const f = fixture();
    const user = { id: 7, role: "technician", isActive: 1 };
    const port = {
      references: async () => [
        { kind: "attachment", id: 2, parentId: 100, entityType: "ticket" },
      ],
      authorize: mediaAccessPort.authorize,
    };
    await expect(
      assertMediaAccess(user, "cmms/uploads/report.mp4", port)
    ).resolves.toBe("cmms/uploads/report.mp4");
    await expect(
      assertMediaAccess(user, "cmms/uploads/report.pdf", port)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assertMediaAccess(user, "cmms/uploads/foreign.png", port)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec(
      "UPDATE maintenance_team_members SET isActive=0 WHERE userId=7"
    );
    await expect(
      assertMediaAccess(user, "cmms/uploads/report.mp4", port)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies arbitrary after-photo/signature keys even if the ticket is assigned to the team", async () => {
    const f = fixture();
    for (const key of ["cmms/uploads/after.jpg", "cmms/uploads/signature.png"])
      expect(await canReadTeamReportMedia(f.db, actor(), 200, key)).toBe(false);
  });
});
