import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SimplifiedPlanForm, type SimplifiedPlanFormProps } from "../../client/src/pages/pmv2/SimplifiedPlanForm";
const noop = async () => {};
const props: SimplifiedPlanFormProps = {
  sites: [{ id: 1, name: "الملقا" }], sections: [{ id: 2, siteId: 1, name: "فودوزو" }], teams: [{ id: 3, name: "الكهرباء" }], dir: "rtl", label: text => text,
  savePlan: async () => ({ id: 4 }), translate: async () => ({ en: "Inspection", ur: "معائنہ" }), addSubtask: noop, activate: noop, pause: noop, resume: noop,
};
describe("simplified maintenance setup form", () => {
  it("starts with the main details and keeps subtask creation hidden before save", () => {
    const html = renderToStaticMarkup(createElement(SimplifiedPlanForm, props));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("عنوان المهمة الرئيسية");
    expect(html).toContain("الملقا");
    expect(html).toContain("الكهرباء");
    expect(html).not.toContain("إنشاء مهمة فرعية");
  });
  it.each([ ["draft", "إنشاء مهمة فرعية"], ["active", "إيقاف مؤقت"], ["paused", "إعادة التفعيل"] ] as const)("offers the correct action in %s", (state, expected) => {
    const initialPlan = { id: 4, title: "فحص فودوزو", siteId: 1, sectionId: 2, teamId: 3, state, items: [{ titleAr: "فحص", titleEn: "Inspection", titleUr: "معائنہ", recurrence: { kind: "daily" as const, startDate: "2026-11-01" } }] };
    const html = renderToStaticMarkup(createElement(SimplifiedPlanForm, { ...props, initialPlan }));
    expect(html).toContain("فحص فودوزو");
    expect(html).toContain(expected);
  });
});
