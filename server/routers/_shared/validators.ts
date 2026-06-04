import { z } from "zod";

export { z };

export const idSchema = z.object({ id: z.number() });

export const paginationSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export const dateRangeSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const passwordSchema = z
  .string()
  .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
  .regex(
    /(?=.*[A-Z])(?=.*\d)/,
    "يجب أن تحتوي على حرف كبير ورقم واحد على الأقل"
  );

export const periodSchema = z
  .enum(["week", "month", "quarter", "year", "all", "custom"])
  .default("all");
