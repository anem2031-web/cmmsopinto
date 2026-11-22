import { isPmv2RecurrenceDueOnDate } from "../checklists/recurrence";
import { planResumeOccurrences } from "../scheduler/resume-plan";
import type { SimplifiedSetupRepository } from "./setup-service";

export interface SimplifiedSchedulerRepository extends SimplifiedSetupRepository {
  listActiveAfter(lastId: number, limit: number): Promise<number[]>;
}
export class SimplifiedScheduler {
  constructor(private readonly repository: SimplifiedSchedulerRepository) {}
  async runForDate(date: string) {
    isPmv2RecurrenceDueOnDate({ frequency: "daily", frequencyValue: null, weekday: null, monthDay: null, anchorDate: null }, date);
    let cursor = 0, checked = 0, failed = 0;
    for (;;) {
      const ids = await this.repository.listActiveAfter(cursor, 200);
      if (!ids.length) break;
      for (const id of ids) {
        try {
          await this.repository.transaction(async tx => {
            const plan = await tx.lockPlan(id);
            // Recheck under the same lock used by pause before any generation.
            if (!plan || plan.state !== "active") return;
            if (!await tx.validateSiteSection(plan.siteId, plan.sectionId)) throw new Error("الموقع أو القسم غير متاح");
            if (!await tx.validateTeam(plan.teamId)) throw new Error("فريق الصيانة غير متاح");
            const items = await tx.listItems(id, { from: date, to: date });
            const occurrences = planResumeOccurrences(items, date, date);
            await tx.generate(id, date, occurrences);
          });
          checked += 1;
        } catch { failed += 1; }
      }
      const next = ids[ids.length - 1];
      if (!Number.isSafeInteger(next) || next <= cursor) throw new Error("تعذر متابعة قائمة المهام المجدولة");
      cursor = next;
      if (ids.length < 200) break;
    }
    return { date, checked, failed };
  }
}
