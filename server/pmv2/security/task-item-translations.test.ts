import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { loadAuthorizedTaskItemTitles } from "./task-item-translations";
const { DatabaseSync }=createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
function fixture(){const db=new DatabaseSync(":memory:");db.exec(`CREATE TABLE entity_translations(id INTEGER PRIMARY KEY,entityType TEXT,entityId INTEGER,fieldName TEXT,languageCode TEXT,translatedText TEXT,translationStatus TEXT);
INSERT INTO entity_translations VALUES(1,'PMV2_TASK_ITEM',10,'titleSnapshot','en','Inspection','approved'),(2,'PMV2_TASK_ITEM',11,'titleSnapshot','en','Other team','approved'),(3,'PMV2_TASK_ITEM',10,'titleSnapshot','ur','معائنہ','approved'),(4,'PMV2_TASK_ITEM',12,'titleSnapshot','en','not approved','pending');`);const dialect=new MySqlDialect();let n=0;return {db,get n(){return n},reader:{async execute(q:any){n++;const x=dialect.sqlToQuery(q);return [db.prepare(x.sql).all(...x.params as any[])]}}};}
describe("authorized PMV2 task translations",()=>{
  it("loads only the caller-supplied authorized ids and requested language",async()=>{const f=fixture();const data=await loadAuthorizedTaskItemTitles(f.reader,[10],"en");expect([...data.entries()]).toEqual([[10,"Inspection"]]);expect(data.has(11)).toBe(false);expect((await loadAuthorizedTaskItemTitles(f.reader,[10],"ur")).get(10)).toBe("معائنہ");f.db.close()});
  it("does not expose pending translations and avoids a query for Arabic",async()=>{const f=fixture();expect((await loadAuthorizedTaskItemTitles(f.reader,[12],"en")).size).toBe(0);const n=f.n;expect((await loadAuthorizedTaskItemTitles(f.reader,[10],"ar")).size).toBe(0);expect(f.n).toBe(n);f.db.close()});
  it("batches IDs without caching across requests",async()=>{const f=fixture();await loadAuthorizedTaskItemTitles(f.reader,Array.from({length:501},(_,i)=>i+1),"en");expect(f.n).toBe(2);await loadAuthorizedTaskItemTitles(f.reader,[10],"en");expect(f.n).toBe(3);f.db.close()});
});
