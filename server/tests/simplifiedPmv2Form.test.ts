import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SimplifiedPlanForm, type SimplifiedPlanFormProps } from "../../client/src/pages/pmv2/SimplifiedPlanForm";
const noop = async () => {};
const props: SimplifiedPlanFormProps = {
  sites: [{ id: 1, name: "الملقا" }], sections: [{ id: 2, siteId: 1, name: "فودوزو" }], teams: [{ id: 3, name: "الكهرباء" }], dir: "rtl", language: "ar", label: text => text,
  savePlan: async () => ({ id: 4 }), translate: async () => ({ en: "Inspection", ur: "معائنہ" }),
  updatePlan: noop, addSubtask: async () => ({ id: 9 }), updateSubtask: noop, disableSubtask: noop,
  activate: noop, pause: noop, resume: noop,
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
    const initialPlan = { id: 4, title: "فحص فودوزو", titleEn: "", titleUr: "", siteId: 1, sectionId: 2, teamId: 3, state, items: [{ id: 10, isActive: true, titleAr: "فحص", titleEn: "Inspection", titleUr: "معائنہ", recurrence: { kind: "daily" as const, startDate: "2026-11-01" } }] };
    const html = renderToStaticMarkup(createElement(SimplifiedPlanForm, { ...props, initialPlan }));
    expect(html).toContain("فحص فودوزو");
    expect(html).toContain(expected);
    expect(html).toContain("تعديل المهمة الرئيسية");
    expect(html).toContain("إنشاء مهمة فرعية");
    expect(html).toContain("تعديل المهمة الفرعية");
    expect(html).toContain("تعطيل المهمة الفرعية");
  });

  it("displays only the saved title for the selected language, with Arabic for older untranslated items", () => {
    const initialPlan = {
      id: 4, title: "فحص فودوزو", titleEn: "Check Foodozo", titleUr: "فودوزو کی جانچ", siteId: 1, sectionId: 2, teamId: 3, state: "active" as const,
      items: [
        { id: 10, isActive: true, titleAr: "فحص الأسلاك", titleEn: "Check the wiring", titleUr: "تاروں کی جانچ", recurrence: { kind: "daily" as const, startDate: "2026-11-01" } },
        { id: 11, isActive: false, titleAr: "فحص قديم", titleEn: "", titleUr: "", recurrence: { kind: "daily" as const, startDate: "2026-11-01" } },
      ],
    };
    const titles = { ar: "فحص الأسلاك", en: "Check the wiring", ur: "تاروں کی جانچ" } as const;
    const mainTitles = { ar: "فحص فودوزو", en: "Check Foodozo", ur: "فودوزو کی جانچ" } as const;
    for (const language of ["ar", "en", "ur"] as const) {
      const html = renderToStaticMarkup(createElement(SimplifiedPlanForm, { ...props, initialPlan, language }));
      expect(html).toContain(`<bdi>${titles[language]}</bdi>`);
      expect(html).toContain("<bdi>فحص قديم</bdi>");
      expect(html).toContain(`<bdi>${mainTitles[language]}</bdi>`);
      expect(html).toContain("معطّلة");
      expect(html.match(/تعطيل المهمة الفرعية/g)).toHaveLength(1);
      expect(html.match(/تعديل المهمة الفرعية/g)).toHaveLength(1);
      for (const title of Object.values(titles)) {
        if (title !== titles[language]) expect(html).not.toContain(`<bdi>${title}</bdi>`);
      }
    }
  });
});
