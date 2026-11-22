import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { SqlTicketTeamAssignmentRepository } from "../routers/maintenance-teams/assignment.repository";
import { TicketTeamAssignmentService } from "../maintenance-team-tickets/assignment/service";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

describe("warehouse ticket search", () => {
  it("finds old tickets and literal symbols before the 200-assignment limit, preserving access", async () => {
    const mem=new DatabaseSync(":memory:");
    try {
      mem.exec(`CREATE TABLE ticket_team_assignments(id INTEGER,ticketId INTEGER,ticketNumber TEXT,titleSnapshot TEXT,teamId INTEGER,warehouseId INTEGER,stage TEXT,ticketItemId INTEGER,siteId INTEGER,sectionId INTEGER,createdAt TEXT);
        CREATE TABLE maintenance_teams(id INTEGER,name TEXT);
        CREATE TABLE tickets(id INTEGER,status TEXT,description TEXT);
        CREATE TABLE ticket_items(id INTEGER,ticketId INTEGER);
        CREATE TABLE warehouses(id INTEGER,nameAr TEXT);
        CREATE TABLE sites(id INTEGER,name TEXT);
        CREATE TABLE sections(id INTEGER,name TEXT);
        CREATE TABLE ticket_team_material_needs(id INTEGER,assignmentId INTEGER,itemNameSnapshot TEXT,unitSnapshot TEXT,requestedById INTEGER);
        CREATE TABLE users(id INTEGER,name TEXT);
        INSERT INTO maintenance_teams VALUES(1,'فريق الكهرباء'); INSERT INTO warehouses VALUES(1,'الرئيسي');
        INSERT INTO sites VALUES(1,'موقع'); INSERT INTO sections VALUES(1,'قسم'); INSERT INTO users VALUES(1,'ماجد');`);
      for(let id=1;id<=205;id++) {
        mem.prepare("INSERT INTO tickets VALUES(?,'open','وصف')").run(id);
        mem.prepare("INSERT INTO ticket_items VALUES(?,?)").run(id,id);
        mem.prepare("INSERT INTO ticket_team_assignments VALUES(?,?,?,?,1,1,'waiting_material',?,1,1,?)").run(id,id,id===1?'MT-%_!':`MT-${id}`,`بلاغ ${id}`,id,`2026-01-${String(id%28+1).padStart(2,'0')} ${String(id).padStart(5,'0')}`);
        mem.prepare("INSERT INTO ticket_team_material_needs VALUES(?,?,?,'قطعة',1)").run(id,id,id===1?'مضخة نادرة':'مادة');
      }
      const sqlDialect=new MySqlDialect(), statements:string[]=[];
      const db={execute:async(query:any)=>{const q=sqlDialect.sqlToQuery(query);statements.push(q.sql);if(q.sql.startsWith('SELECT a.id'))return [mem.prepare(q.sql).all(...q.params)];return [[]];}};
      const repository=new SqlTicketTeamAssignmentRepository(async()=>({db:db as any,tickets:{} as any}));
      const service=new TicketTeamAssignmentService(repository);
      const warehouse={id:5,role:'warehouse',active:true} as any;
      const unfiltered=await service.warehouseRequests(warehouse);
      expect(unfiltered).toHaveLength(200);
      const material=await service.warehouseRequests(warehouse,'نادرة');
      expect(material.map(row=>row.ticketNumber)).toEqual(['MT-%_!']);
      expect((await service.warehouseRequests(warehouse,'%_!')).map(row=>row.ticketNumber)).toEqual(['MT-%_!']);
      expect(statements.find(q=>q.includes('searchNeed.itemNameSnapshot'))).toContain('LIMIT 200');
      await expect(service.warehouseRequests({id:8,role:'technician',active:true} as any,'نادرة')).rejects.toThrow();
    } finally {mem.close()}
  });
});
