import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { isUnifiedSpecialty, isUnifiedTeam } from "./unified-team-management";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function fixture() {
  const db=new DatabaseSync(":memory:"); db.exec("CREATE TABLE pmv2_teams(id INTEGER PRIMARY KEY,specialtyId INTEGER);CREATE TABLE pmv2_unified_team_links(pmv2TeamId INTEGER,maintenanceTeamId INTEGER);INSERT INTO pmv2_teams VALUES(10,100),(11,101);INSERT INTO pmv2_unified_team_links VALUES(10,20)");
  const dialect=new MySqlDialect();let count=0;return {db,get count(){return count},reader:{async execute(q:any){count++;const s=dialect.sqlToQuery(q);return [db.prepare(s.sql).all(...s.params as any[])]}}};
}
afterEach(()=>vi.unstubAllEnvs());
describe("unified PMV2 team management guard",()=>{
  it("protects linked teams and specialties but leaves unlinked historical teams unchanged",async()=>{vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true");const f=fixture();expect(await isUnifiedTeam(f.reader,10)).toBe(true);expect(await isUnifiedTeam(f.reader,11)).toBe(false);expect(await isUnifiedSpecialty(f.reader,100)).toBe(true);expect(await isUnifiedSpecialty(f.reader,101)).toBe(false);f.db.close()});
  it("does not read new tables or alter legacy behavior when disabled",async()=>{vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","false");const f=fixture();expect(await isUnifiedTeam(f.reader,10)).toBe(false);expect(await isUnifiedSpecialty(f.reader,100)).toBe(false);expect(f.count).toBe(0);f.db.close()});
});
