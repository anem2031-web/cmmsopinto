import { z } from "zod";

export const isLotSelectionValidationError = (
  error: unknown
): error is z.ZodError => error instanceof z.ZodError;

/** Presentation only: schema validation and stock rules remain unchanged. */
export function warehouseLotValidationMessage(error: unknown): string {
  if (isLotSelectionValidationError(error)) {
    if (
      error.issues.some(
        issue =>
          issue.path.length === 1 &&
          issue.path[0] === "lots" &&
          issue.code === "too_small"
      )
    )
      return "اختر لوتًا واحدًا على الأقل وحدد الكمية، أو استخدم خيار الأقدم.";
    if (error.issues.some(issue => issue.path.includes("quantity")))
      return "أدخل كمية صحيحة أكبر من صفر لكل لوت مختار.";
    return "راجع اختيار اللوتات والكميات المطلوبة.";
  }
  return error instanceof Error
    ? error.message
    : "تعذر التحقق من اللوتات المختارة.";
}
