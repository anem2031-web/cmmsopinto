import { describe, expect, it } from "vitest";
import { buildItemRevisionComment } from "../routers/purchase/item-revision-comment";

describe("truthful item revision conversation", () => {
  it("reports specification and quantity changes without requiring a name change", () => {
    const note = buildItemRevisionComment({ itemName: "Same name", description: "1/2 inch", quantity: "2.000" }, { itemName: "Same name", description: "3/4 inch", quantity: 3, status: "pending", itemRevisionNote: null });
    expect(note).toContain("المواصفات:\nقبل: «1/2 inch»\nبعد: «3/4 inch»");
    expect(note).toContain("الكمية:\nقبل: «2.000»\nبعد: «3»");
    expect(note).not.toContain("اسم الصنف"); expect(note).not.toContain("status"); expect(note).not.toContain("itemRevisionNote");
  });
  it.each([["2.000", 2], ["0002.00", "2"], ["0.00", "-0"], ["9007199254740992.0000", "9007199254740992"]])("ignores numeric formatting only: %s -> %s", (before, after) => {
    expect(buildItemRevisionComment({ quantity: before }, { quantity: after })).toBe("أُعيد الإرسال دون تعديل بيانات الصنف.");
  });
  it("does not round large decimal changes into equality", () => {
    expect(buildItemRevisionComment({ estimatedUnitCost: "9007199254740992.0000" }, { estimatedUnitCost: "9007199254740993.0000" })).toContain("بعد: «9007199254740993.0000»");
  });
  it("distinguishes an empty price from a zero price", () => {
    expect(buildItemRevisionComment({ estimatedUnitCost: null }, { estimatedUnitCost: "0" })).toContain("قبل: «فارغ»\nبعد: «0»");
  });
  it("records clearing text and adding/changing pictures, preserving multiline text", () => {
    const note = buildItemRevisionComment({ notes: "Old note", photoUrl: null, description: "Old" }, { notes: "", photoUrl: "/new.jpg", description: "Line one\nLine two" });
    expect(note).toContain("الملاحظات:\nقبل: «Old note»\nبعد: «فارغ»"); expect(note).toContain("الصورة:\nقبل: «فارغ»\nبعد: «/new.jpg»"); expect(note).toContain("Line one\nLine two");
  });
  it("compares only actually written fields and treats null/empty unchanged text alike", () => {
    expect(buildItemRevisionComment({ quantity: 5, description: null, notes: "Existing" }, { description: "", notes: undefined, status: "pending" })).toBe("أُعيد الإرسال دون تعديل بيانات الصنف.");
  });
});
