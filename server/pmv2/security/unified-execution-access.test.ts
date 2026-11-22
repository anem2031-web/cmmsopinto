import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { pmv2ExecutionTeamCondition } from "./execution-access";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER);
    CREATE TABLE pmv2_unified_team_links(pmv2TeamId INTEGER PRIMARY KEY,maintenanceTeamId INTEGER UNIQUE);
    CREATE TABLE maintenance_teams(id INTEGER PRIMARY KEY,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    INSERT INTO users VALUES(1,'technician',1),(2,'technician',1),(3,'technician',0),(4,'owner',1);
    INSERT INTO pmv2_unified_team_links VALUES(10,20); INSERT INTO maintenance_teams VALUES(20,1);
    INSERT INTO maintenance_team_members VALUES(20,1,1),(20,3,1); INSERT INTO pmv2_team_members VALUES(10,2,1),(11,2,1);`);
  const dialect = new MySqlDialect();
  const check = (user: number, team: number) => {
    const clause = dialect.sqlToQuery(pmv2ExecutionTeamCondition(user, team)!);
    return db.prepare(`SELECT 1 AS allowed FROM users AS pmv2ExecutionActor WHERE ${clause.sql}`).all(...clause.params as any[]).length > 0;
  };
  return { db, check };
}
afterEach(() => vi.unstubAllEnvs());
describe("PMV2 unified technician execution scope", () => {
  it("checks the real current account, linked team membership, and legacy fallback", () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED", "true"); const f = setup();
    expect(f.check(1,10)).toBe(true);
    expect(f.check(2,10)).toBe(false);
    expect(f.check(2,11)).toBe(true);
    expect(f.check(3,10)).toBe(false);
    expect(f.check(4,10)).toBe(true);
    f.db.close();
  });
  it("preserves existing PMV2 membership when the new feature is disabled", () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED", "false"); const f = setup();
    expect(f.check(1,10)).toBe(false);
    expect(f.check(2,10)).toBe(true);
    f.db.close();
  });
});
