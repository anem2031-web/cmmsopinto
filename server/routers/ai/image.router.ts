import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { invokeLLM } from "../../_core/llm";

export const imageRouter = router({
  analyzeFaultImage: protectedProcedure.input(z.object({
      imageUrl: z.string().url(),
      assetName: z.string().optional(),
      assetCategory: z.string().optional(),
      description: z.string().optional(),
    })).mutation(async ({ input }) => {
      const systemPrompt = `أنت خبير هندسي متخصص في تشخيص أعطال المعدات والأصول. 
عند تحليل صورة العطل، قدم:
1. تشخيص العطل المحتمل
2. مستوى الخطورة (منخفض/متوسط/عالٍ/حرج)
3. الأسباب المحتملة
4. الإجراءات التصحيحية الموصى بها
5. هل يحتاج إلى إيقاف تشغيل فوري؟
أجب بصيغة JSON منظمة.`;

      const userMessage = `الأصل: ${input.assetName ?? "غير محدد"} | الفئة: ${input.assetCategory ?? "غير محدد"}\nالوصف: ${input.description ?? "لا يوجد وصف"}\nرابط الصورة: ${input.imageUrl}\n\nحلل صورة العطل وقدم تشخيصاً مفصلاً.`;
      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "fault_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                diagnosis: { type: "string", description: "تشخيص العطل" },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "مستوى الخطورة" },
                causes: { type: "array", items: { type: "string" }, description: "الأسباب المحتملة" },
                recommendations: { type: "array", items: { type: "string" }, description: "الإجراءات الموصى بها" },
                requiresImmediateShutdown: { type: "boolean", description: "هل يحتاج إيقاف تشغيل فوري" },
                estimatedRepairTime: { type: "string", description: "الوقت التقديري للإصلاح" },
                confidence: { type: "number", description: "مستوى الثقة 0-100" },
              },
              required: ["diagnosis", "severity", "causes", "recommendations", "requiresImmediateShutdown", "estimatedRepairTime", "confidence"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل تحليل الصورة" });
      return JSON.parse(content as string);
    }),
});
