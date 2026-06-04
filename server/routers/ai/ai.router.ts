import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import { invokeLLM } from "../../_core/llm";
import * as db from "../../db";

export const aiRouter = router({
  analyze: protectedProcedure.input(z.object({
    question: z.string(),
    conversationHistory: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })).optional(),
  })).mutation(async ({ input, ctx }) => {
    // جمع بيانات شاملة من قاعدة البيانات
    const [tickets, pos, inventoryItems, allUsers, allSites, stats, recentAudit] = await Promise.all([
      db.getTickets(),
      db.getPurchaseOrders(),
      db.getInventoryItems(),
      db.getAllUsers(),
      db.getAllSites(),
      db.getDashboardStats(),
      db.getAuditLogsEnhanced({ limit: 50 }),
    ]);

    // تحليل البلاغات
    const ticketsByStatus = tickets.reduce((acc: any, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
    const ticketsByPriority = tickets.reduce((acc: any, t) => { acc[t.priority] = (acc[t.priority] || 0) + 1; return acc; }, {});
    const ticketsByCategory = tickets.reduce((acc: any, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {});
    const ticketsBySite = tickets.reduce((acc: any, t) => { const site = allSites.find(s => s.id === t.siteId); acc[site?.name || `موقع #${t.siteId}`] = (acc[site?.name || `موقع #${t.siteId}`] || 0) + 1; return acc; }, {});

    // تحليل طلبات الشراء
    const posByStatus = pos.reduce((acc: any, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
    const totalPOCost = pos.reduce((sum, p) => sum + parseFloat(p.totalEstimatedCost || "0"), 0);
    const totalActualCost = pos.reduce((sum, p) => sum + parseFloat(p.totalActualCost || "0"), 0);

    // تحليل المخزون
    const lowStockItems = inventoryItems.filter((i: any) => i.quantity <= i.minQuantity);

    // تفاصيل البلاغات (آخر 20)
    const recentTickets = tickets.slice(0, 20).map(t => ({
      id: t.id, ticketNumber: t.ticketNumber, title: t.title, description: t.description,
      status: t.status, priority: t.priority, category: t.category,
      assignedTo: allUsers.find(u => u.id === t.assignedToId)?.name || "غير مسند",
      reportedBy: allUsers.find(u => u.id === t.reportedById)?.name || "غير معروف",
      site: allSites.find(s => s.id === t.siteId)?.name || "",
      createdAt: new Date(t.createdAt).toLocaleDateString("ar-SA"),
    }));

    // تفاصيل طلبات الشراء (آخر 20)
    const recentPOs = pos.slice(0, 20).map(p => ({
      id: p.id, poNumber: p.poNumber, status: p.status,
      estimatedCost: p.totalEstimatedCost, actualCost: p.totalActualCost,
      requestedBy: allUsers.find(u => u.id === p.requestedById)?.name || "",
      createdAt: new Date(p.createdAt).toLocaleDateString("ar-SA"),
    }));

    const dbContext = `
=== بيانات نظام إدارة الصيانة (CMMS) - محدثة الآن ===

ـــ إحصائيات عامة ـــ
• إجمالي البلاغات: ${tickets.length}
• البلاغات المفتوحة: ${stats?.openTickets || 0}
• المغلقة اليوم: ${stats?.closedToday || 0}
• الحرجة: ${stats?.criticalTickets || 0}
• طلبات شراء بانتظار الاعتماد: ${stats?.pendingApprovals || 0}
• إجمالي تكلفة الصيانة: ${stats?.totalMaintenanceCost || 0} ر.س

ـــ توزيع البلاغات ـــ
حسب الحالة: ${JSON.stringify(ticketsByStatus)}
حسب الأولوية: ${JSON.stringify(ticketsByPriority)}
حسب الفئة: ${JSON.stringify(ticketsByCategory)}
حسب الموقع: ${JSON.stringify(ticketsBySite)}

ـــ طلبات الشراء ـــ
إجمالي طلبات الشراء: ${pos.length}
حسب الحالة: ${JSON.stringify(posByStatus)}
إجمالي التكلفة المقدرة: ${totalPOCost.toFixed(2)} ر.س
إجمالي التكلفة الفعلية: ${totalActualCost.toFixed(2)} ر.س

ـــ المخزون ـــ
إجمالي الأصناف: ${inventoryItems.length}
أصناف منخفضة المخزون: ${lowStockItems.length}
${lowStockItems.length > 0 ? `الأصناف المنخفضة: ${lowStockItems.map((i: any) => `${i.itemName} (الكمية: ${i.quantity}, الحد الأدنى: ${i.minQuantity})`).join(" | ")}` : ""}
قائمة المخزون: ${JSON.stringify(inventoryItems.map((i: any) => ({ name: i.itemName, qty: i.quantity, min: i.minQuantity, unit: i.unit, location: i.location })))}

ـــ المستخدمون ـــ
إجمالي: ${allUsers.length}
القائمة: ${allUsers.map(u => `${u.name} (الدور: ${u.role}, القسم: ${u.department || "-"})`).join(" | ")}

ـــ المواقع ـــ
${allSites.map(s => `${s.name}: ${s.address || "-"}`).join(" | ")}

ـــ آخر 20 بلاغ ـــ
${JSON.stringify(recentTickets, null, 0)}

ـــ آخر 20 طلب شراء ـــ
${JSON.stringify(recentPOs, null, 0)}

ـــ آخر 50 عملية تدقيق ـــ
${JSON.stringify(recentAudit.map((a: any) => ({ action: a.action, entity: a.entityType, id: a.entityId, desc: a.description, date: new Date(a.createdAt).toLocaleDateString("ar-SA") })), null, 0)}
`;

    const systemPrompt = `أنت "مساعد الصيانة الذكي" - مساعد AI متخصص في نظام إدارة الصيانة المتكامل (CMMS).

قواعدك الأساسية:
1. أجب بنفس لغة المستخدم تماماً:
 - إذا كتب بالعربية الفصحى → أجب بالفصحى
 - إذا كتب باللهجة السعودية (مثل: "وش البلاغات اليوم؟", "كم عندنا طلب شراء؟", "وشلون المخزون؟", "ايش السالفة؟", "وين المشكلة؟") → أجب باللهجة السعودية
 - إذا كتب باللهجة المصرية (مثل: "ايه البلاغات دي؟", "عايز اعرف", "فين المشكلة؟") → أجب باللهجة المصرية
 - If user writes in English → Reply in English
 - اگر صارف اردو میں لکھے → اردو میں جواب دیں

2. لديك وصول كامل لقاعدة بيانات النظام. استخدم البيانات المرفقة للإجابة بدقة.

3. يمكنك الإجابة عن:
 - البلاغات: عددها، حالاتها، أولوياتها، فئاتها، من أنشأها، من مسند إليه، الموقع، التاريخ
 - طلبات الشراء: عددها، حالاتها، تكاليفها، من طلبها
 - المخزون: الأصناف، الكميات، الأصناف المنخفضة
 - المستخدمين: أسماؤهم، أدوارهم، أقسامهم
 - المواقع: أسماؤها، عناوينها
 - سجل التدقيق: آخر العمليات
 - التكاليف والإحصائيات المالية
 - تحليل الأداء والتوصيات
 - خطط الصيانة الوقائية

4. كن مفيداً وعملياً. استخدم الأرقام الفعلية من البيانات. لا تخترع بيانات.

5. استخدم تنسيق Markdown للردود (عناوين، جداول، قوائم) لتكون واضحة ومنظمة.

6. إذا سأل المستخدم عن شيء غير موجود في البيانات، أخبره بذلك بوضوح.

7. المستخدم الحالي: ${ctx.user?.name || "غير معروف"} (الدور: ${ctx.user?.role || "غير محدد"})`;

    // بناء سجل المحادثة
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `هذه بيانات النظام المحدثة:\n${dbContext}` },
      { role: "assistant", content: "تم تحميل بيانات النظام بنجاح. أنا جاهز للإجابة على أي سؤال." },
    ];

    // إضافة سجل المحادثة السابق
    if (input.conversationHistory?.length) {
      for (const msg of input.conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // إضافة السؤال الحالي
    messages.push({ role: "user", content: input.question });

    const response = await invokeLLM({ messages });
    return { answer: response.choices[0]?.message?.content || "لم أتمكن من الإجابة" };
  }),
});
