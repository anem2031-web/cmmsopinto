import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { loadUnifiedTeamNames } from "./unified-team-names";
const { DatabaseSync }=createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function fixture(){const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE pmv2_unified_team_links(pmv2TeamId INTEGER,maintenanceTeamId INTEGER);CREATE TABLE maintenance_teams(id INTEGER,name TEXT);INSERT INTO pmv2_unified_team_links VALUES(10,20),(11,20);INSERT INTO maintenance_teams VALUES(20,'فريق الكهرباء')");const dialect=new MySqlDialect();let queries=0;return {db,get queries(){return queries},reader:{async execute(q:any){queries++;const x=dialect.sqlToQuery(q);return [db.prepare(x.sql).all(...x.params as any[])]}}};}
afterEach(()=>vi.unstubAllEnvs());
describe("unified team names",()=>{
  it("maps only requested team ids and batches large scopes",async()=>{vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","true");const f=fixture();const names=await loadUnifiedTeamNames(f.reader,Array.from({length:501},(_,i)=>i+1));expect(names.get(10)).toBe("فريق الكهرباء");expect(names.get(11)).toBe("فريق الكهرباء");expect(names.has(12)).toBe(false);expect(f.queries).toBe(2);f.db.close()});
  it("does not query new tables when disabled",async()=>{vi.stubEnv("PMV2_SIMPLIFIED_ENABLED","false");const f=fixture();expect((await loadUnifiedTeamNames(f.reader,[10])).size).toBe(0);expect(f.queries).toBe(0);f.db.close()});
});
