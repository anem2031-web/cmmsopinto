import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { isSimplifiedChecklist, isSimplifiedProgram } from "./legacy-write-guard";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE pmv2_programs(id INTEGER PRIMARY KEY,checklistId INTEGER); CREATE TABLE pmv2_simplified_plans(programId INTEGER PRIMARY KEY); CREATE TABLE pmv2_simplified_plan_revisions(programId INTEGER PRIMARY KEY,planId INTEGER); INSERT INTO pmv2_programs VALUES(1,10),(2,20); INSERT INTO pmv2_simplified_plans VALUES(1); INSERT INTO pmv2_simplified_plan_revisions VALUES(3,1)");
  const dialect = new MySqlDialect(); let calls = 0;
  return { db, get calls() { return calls; }, reader: { async execute(q: any) { calls++; const query = dialect.sqlToQuery(q); return [db.prepare(query.sql).all(...query.params as any[])]; } } };
}
afterEach(() => vi.unstubAllEnvs());
describe("simplified plans protected from legacy setup", () => {
  it("identifies a protected plan and checklist while leaving historical plans alone", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED", "true"); const f = fixture();
    expect(await isSimplifiedProgram(f.reader, 1)).toBe(true); expect(await isSimplifiedChecklist(f.reader, 10)).toBe(true);
    expect(await isSimplifiedProgram(f.reader, 3)).toBe(true);
    expect(await isSimplifiedProgram(f.reader, 2)).toBe(false); expect(await isSimplifiedChecklist(f.reader, 20)).toBe(false); f.db.close();
  });
  it("does not query new schema when the feature is off", async () => {
    vi.stubEnv("PMV2_SIMPLIFIED_ENABLED", "false"); const f = fixture();
    expect(await isSimplifiedProgram(f.reader, 1)).toBe(false); expect(await isSimplifiedChecklist(f.reader, 10)).toBe(false); expect(f.calls).toBe(0); f.db.close();
  });
});
