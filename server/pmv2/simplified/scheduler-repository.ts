import { sql } from "drizzle-orm";
import { SimplifiedSqlRepository } from "./setup-repository";
import type { SetupSqlTx } from "./setup-sql";
import type { SimplifiedSchedulerRepository } from "./scheduler";

type SchedulerDb = SetupSqlTx & { transaction<T>(work: (tx: SetupSqlTx) => Promise<T>): Promise<T> };
export class SimplifiedSqlSchedulerRepository extends SimplifiedSqlRepository implements SimplifiedSchedulerRepository {
  constructor(private readonly getDatabase: () => Promise<SchedulerDb>) { super(getDatabase); }
  async listActiveAfter(lastId: number, limit: number): Promise<number[]> {
    if (!Number.isSafeInteger(lastId) || lastId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("نطاق الجدولة غير صالح");
    const db = await this.getDatabase();
    const result = await db.execute(sql`SELECT programId FROM pmv2_simplified_plans WHERE state='active' AND programId>${lastId} ORDER BY programId LIMIT ${limit}`);
    if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة البرامج المجدولة");
    return result[0].map((row: any) => Number(row.programId));
  }
}
