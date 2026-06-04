import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { invokeLLM } from "../../_core/llm";

export const llmRouter = router({
  predictAtRiskAssets: protectedProcedure.mutation(async () => {
      const assets = await db.listAssets({});
      const tickets = await db.getTickets();

      if (assets.length === 0) {
        return { atRiskAssets: [], summary: "لا توجد أصول مسجلة بعد" };
      }

      // Build asset maintenance history summary
      const assetSummaries = assets.slice(0, 20).map((asset: any) => {
        const assetTickets = tickets.filter((t: any) => t.assetId === asset.id);
        const recentTickets = assetTickets.filter((t: any) => {
          const days = (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          return days <= 90;
        });
        return {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          status: asset.status,
          warrantyExpiry: asset.warrantyExpiry,
          totalTickets: assetTickets.length,
          recentTickets: recentTickets.length,
          lastTicketDate: assetTickets.length > 0 ? assetTickets[assetTickets.length - 1].createdAt : null,
        };
      });

      const result = await invokeLLM({
        messages: [
          { role: "system", content: "أنت محلل بيانات صيانة متخصص. بناءً على بيانات الأصول وتاريخ الأعطال، حدد الأصول الأكثر عرضة للأعطال وقدم توصيات وقائية." },
          { role: "user", content: `بيانات الأصول:\n${JSON.stringify(assetSummaries, null, 2)}\n\nحدد الأصول الأكثر خطورة وقدم توصيات.` as string },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "risk_prediction",
            strict: true,
            schema: {
              type: "object",
              properties: {
                atRiskAssets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      assetId: { type: "number" },
                      assetName: { type: "string" },
                      riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      reason: { type: "string" },
                      recommendation: { type: "string" },
                    },
                    required: ["assetId", "assetName", "riskLevel", "reason", "recommendation"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string", description: "ملخص التحليل" },
              },
              required: ["atRiskAssets", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل التحليل" });
      return JSON.parse(content as string);
    }),
});
