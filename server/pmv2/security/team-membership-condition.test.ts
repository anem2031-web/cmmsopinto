import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { pmv2MembershipCondition } from "./team-membership-condition";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE pmv2_unified_team_links(pmv2TeamId INTEGER PRIMARY KEY,maintenanceTeamId INTEGER UNIQUE);
    CREATE TABLE maintenance_teams(id INTEGER PRIMARY KEY,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);`);
  const dialect = new MySqlDialect();
  const check = (user: number, team: number) => {
    const query = dialect.sqlToQuery(pmv2MembershipCondition(user, team));
    return Number(db.prepare(`SELECT ${query.sql} AS allowed`).get(...query.params as number[])?.allowed) === 1;
  };
  return { db, check };
}

describe("PMV2 unified team membership", () => {
  it("keeps membership for unlinked historical teams only when active", () => {
    const { db, check } = setup();
    db.exec("INSERT INTO pmv2_team_members VALUES(10,1,1),(10,2,0),(11,3,1)");
    expect(check(1, 10)).toBe(true);
    expect(check(2, 10)).toBe(false);
    expect(check(3, 10)).toBe(false);
    db.close();
  });
  it("uses current membership for linked teams and ignores old PMV2 member records", () => {
    const { db, check } = setup();
    db.exec("INSERT INTO pmv2_unified_team_links VALUES(10,20); INSERT INTO maintenance_teams VALUES(20,1),(21,1); INSERT INTO maintenance_team_members VALUES(20,2,1),(20,3,0),(21,4,1); INSERT INTO pmv2_team_members VALUES(10,1,1)");
    expect(check(1, 10)).toBe(false);
    expect(check(2, 10)).toBe(true);
    expect(check(3, 10)).toBe(false);
    expect(check(4, 10)).toBe(false);
    db.exec("UPDATE maintenance_team_members SET isActive=0 WHERE teamId=20 AND userId=2");
    expect(check(2, 10)).toBe(false);
    db.close();
  });
  it("denies access when the linked maintenance team is inactive", () => {
    const { db, check } = setup();
    db.exec("INSERT INTO pmv2_unified_team_links VALUES(10,20); INSERT INTO maintenance_teams VALUES(20,0); INSERT INTO maintenance_team_members VALUES(20,2,1)");
    expect(check(2, 10)).toBe(false);
    db.close();
  });
});
