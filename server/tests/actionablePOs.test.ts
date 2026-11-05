import { describe, expect, it } from "vitest";
import { computeActionablePOs, getDelegateItemActionMode } from "../routers/purchase/actionable";
import { ROLE } from "../_core/authz/policy";

// ══════════════════════════════════════════════════════════════════════════
// اختبارات "بانتظار إجرائي" — الفئات الثلاث لكل دور
// ══════════════════════════════════════════════════════════════════════════

const po = (over: Partial<any> = {}) => ({
  id: 1, poNumber: "PO-0001", status: "pending_review", requestedById: 99, ...over,
});

describe("قائمة أصناف المندوب بعد اعتماد دفعة جزئية", () => {
  it("يعرض شراء الصنف المعتمد في دفعة رغم انتظار حالة الطلب العامة للحسابات", () => {
    expect(getDelegateItemActionMode("pending_accounting", { status: "approved", batchId: 10, delegateChangeRequestedAt: null })).toBe("purchase");
  });
  it("يبقي دفعة معتمدة للشراء أثناء إعادة تسعير صنف آخر فقط، مع بقاء قيود الطلب غير المرسل", () => {
    expect(getDelegateItemActionMode("pending_estimate", { status: "approved", batchId: 10, delegateChangeRequestedAt: null })).toBe("purchase");
    expect(getDelegateItemActionMode("pending_estimate", { status: "approved", batchId: null, delegateChangeRequestedAt: null })).toBeNull();
    for (const status of ["draft", "pending_review", "revision_needed", "closed", "rejected"]) {
      expect(getDelegateItemActionMode(status, { status: "approved", batchId: 10, delegateChangeRequestedAt: null })).toBeNull();
    }
  });
  it("لا يعرض شراء صنف بلا دفعة معتمدة أو صنف مرفوض", () => {
    expect(getDelegateItemActionMode("pending_accounting", { status: "approved", batchId: null, delegateChangeRequestedAt: null })).toBeNull();
    expect(getDelegateItemActionMode("pending_accounting", { status: "rejected", batchId: 10, delegateChangeRequestedAt: null })).toBeNull();
  });
});

describe("الفئة 1 — طلب بمرحلة يستطيع دور المستخدم التصرف فيها", () => {
  it("مدير الصيانة يرى طلبًا بمرحلة المراجعة", () => {
    const r = computeActionablePOs(
      { id: 8, role: "maintenance_manager" },
      [po({ status: "pending_review" })],
      []
    );
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("يحتاج مراجعتك وتوزيع الأصناف");
    expect(r[0].actionLabel).toBe("راجع");
  });

  it("المحاسب يرى طلبًا بمرحلة الاعتماد المحاسبي فقط", () => {
    const acc = { id: 3, role: "accountant" };
    const inStage = computeActionablePOs(acc, [po({ status: "pending_accounting" })], []);
    expect(inStage).toHaveLength(1);
    expect(inStage[0].reason).toBe("يحتاج اعتمادك المحاسبي");

    // بعد اعتماده، لا يعود يظهر له
    const passed = computeActionablePOs(acc, [po({ status: "pending_management" })], []);
    expect(passed).toHaveLength(0);
  });

  it("الإدارة العليا ترى مرحلة الاعتماد الإداري، والمدير التنفيذي لا (ممنوع من الاعتماد)", () => {
    const mgmt = computeActionablePOs({ id: 4, role: "senior_management" }, [po({ status: "pending_management" })], []);
    expect(mgmt).toHaveLength(1);

    const exec = computeActionablePOs({ id: 5, role: "executive_director" }, [po({ status: "pending_management" })], []);
    expect(exec).toHaveLength(0);
  });

  it("دور لا علاقة له بالطلب لا يرى شيئًا", () => {
    const r = computeActionablePOs({ id: 7, role: "technician" }, [po({ status: "pending_accounting" })], []);
    expect(r).toHaveLength(0);
  });
});

describe("الفئة 2 — طلب رُدّ لمنشئه للمراجعة", () => {
  it("منشئ الطلب يراه مع الإجراء الصحيح", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      []
    );
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("رُدّ إليك للمراجعة");
    expect(r[0].actionLabel).toBe("تعديل وإعادة إرسال");
  });

  it("مستخدم آخر لا يراه", () => {
    const r = computeActionablePOs(
      { id: 50, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      []
    );
    expect(r).toHaveLength(0);
  });
});

describe("الفئة 3 — صنف ملغى أو يحتاج مراجعة (قرار منشئ الطلب)", () => {
  const items = [
    { purchaseOrderId: 1, status: "purchase_cancelled" },
    { purchaseOrderId: 1, status: "approved" },
    { purchaseOrderId: 1, status: "approved" },
    { purchaseOrderId: 1, status: "approved" },
    { purchaseOrderId: 1, status: "approved" },
  ];

  it("منشئ الطلب يرى صنفًا ملغى مع العدد التفصيلي", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "approved", requestedById: 99 })],
      items
    );
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("صنف ملغى يحتاج قرارك — 1 من 5 أصناف");
    expect(r[0].actionLabel).toBe("معالجة");
  });

  it("صنف بحالة مراجعة يعطي وصفًا مختلفًا", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "approved", requestedById: 99 })],
      [{ purchaseOrderId: 1, status: "needs_item_revision" }, { purchaseOrderId: 1, status: "approved" }]
    );
    expect(r[0].reason).toBe("صنف يحتاج مراجعتك — 1 من 2 أصناف");
  });

  it("مستخدم ليس منشئ الطلب لا يراه ضمن هذي الفئة", () => {
    const r = computeActionablePOs(
      { id: 50, role: "purchase_requester" },
      [po({ status: "approved", requestedById: 99 })],
      items
    );
    expect(r).toHaveLength(0);
  });
});

describe("ملخص الأصناف — 'تم شراء 3 من 5'", () => {
  it("يظهر عند وجود تقدم جزئي فعلي", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      [
        { purchaseOrderId: 1, status: "purchased" },
        { purchaseOrderId: 1, status: "purchased" },
        { purchaseOrderId: 1, status: "purchased" },
        { purchaseOrderId: 1, status: "approved" },
        { purchaseOrderId: 1, status: "approved" },
      ]
    );
    expect(r[0].itemsSummary).toBe("تم شراء 3 من 5");
  });

  it("لا يظهر إذا لم يُشترَ شيء بعد", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      [{ purchaseOrderId: 1, status: "approved" }, { purchaseOrderId: 1, status: "approved" }]
    );
    expect(r[0].itemsSummary).toBeUndefined();
  });

  it("لا يظهر إذا اكتمل الشراء بالكامل (لا يوجد 'جزئي')", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      [{ purchaseOrderId: 1, status: "purchased" }, { purchaseOrderId: 1, status: "purchased" }]
    );
    expect(r[0].itemsSummary).toBeUndefined();
  });
});

describe("سلوك عام", () => {
  it("لا يكرّر الطلب الواحد مرتين حتى لو انطبقت أكثر من فئة", () => {
    const r = computeActionablePOs(
      { id: 99, role: "purchase_requester" },
      [po({ status: "revision_needed", requestedById: 99 })],
      [{ purchaseOrderId: 1, status: "needs_item_revision" }]
    );
    expect(r).toHaveLength(1);
  });

  it("قائمة فارغة تُرجع نتيجة فارغة", () => {
    expect(computeActionablePOs({ id: 1, role: "owner" }, [], [])).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// إصلاحات 2026-07-30 — اكتُشفت بالاستخدام الفعلي (طلبات ماجد المختفية)
// ══════════════════════════════════════════════════════════════════════════

describe("الفئة 4 — مسودة لم تُرسل (بانتظار منشئها)", () => {
  it("منشئ المسودة يراها مع إجراء الإكمال", () => {
    const r = computeActionablePOs(
      { id: 99, role: "warehouse" },
      [po({ status: "draft", requestedById: 99 })],
      []
    );
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("مسودة لم تُرسل بعد");
    expect(r[0].actionLabel).toBe("إكمال وإرسال");
  });

  it("كل دور مسموح له بالإنشاء يرى مسودته في بانتظار إجرائي حتى يرسلها", () => {
    for (const role of Object.values(ROLE)) {
      const r = computeActionablePOs(
        { id: 99, role },
        [po({ status: "draft", requestedById: 99 })],
        []
      );
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        reason: "مسودة لم تُرسل بعد",
        actionLabel: "إكمال وإرسال",
      });
    }
  });

  it("مستخدم آخر لا يرى مسودة غيره", () => {
    const r = computeActionablePOs(
      { id: 50, role: "warehouse" },
      [po({ status: "draft", requestedById: 99 })],
      []
    );
    expect(r).toHaveLength(0);
  });

  it("المشرف يراها بوصف صادق أنها مسودة غيره", () => {
    const r = computeActionablePOs(
      { id: 1, role: "owner" },
      [po({ status: "draft", requestedById: 99 })],
      []
    );
    expect(r[0].reason).toBe("مسودة لم يُرسلها منشئها بعد");
  });
});


  it("owner/admin يرى الطلب المرتجع للمراجعة كإجراء متاح حتى لو لم يكن المنشئ", () => {
    const result = computeActionablePOs(
      { id: 99, role: "admin" },
      [po({ id: 77, status: "revision_needed", requestedById: 12 })],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 77, actionLabel: "تعديل وإعادة إرسال" });
  });

describe("owner/admin — سبب صادق لكل مرحلة بدل رسالة موحّدة مضلّلة", () => {
  const cases: Array<[string, string]> = [
    ["pending_review", "بانتظار مراجعة مدير الصيانة"],
    ["pending_estimate", "بانتظار تسعير المندوب"],
    ["pending_accounting", "بانتظار اعتماد الحسابات"],
    ["pending_management", "بانتظار اعتماد الإدارة العليا"],
    ["approved", "بانتظار شراء المندوب"],
  ];

  for (const [status, expectedReason] of cases) {
    it(`${status} → "${expectedReason}"`, () => {
      const r = computeActionablePOs({ id: 1, role: "owner" }, [po({ status })], []);
      expect(r).toHaveLength(1);
      expect(r[0].reason).toBe(expectedReason);
    });
  }

  it("🔴 الخلل المُصلَح: لا تظهر كل المراحل بنفس السبب", () => {
    const reasons = cases.map(([status]) =>
      computeActionablePOs({ id: 1, role: "owner" }, [po({ status })], [])[0].reason
    );
    expect(new Set(reasons).size).toBe(reasons.length); // كل مرحلة سببها مختلف
  });
});

describe("warehouse — دور مزدوج: مستلِم ومُنشئ", () => {
  it("يرى طلبه الخاص بمرحلة التسعير (كان محجوبًا قبل الإصلاح)", () => {
    const r = computeActionablePOs(
      { id: 9090247, role: "warehouse" },
      [po({ status: "pending_estimate", requestedById: 9090247 })],
      []
    );
    // لا إجراء له بهذي المرحلة (المندوب يسعّر) — فلا يظهر بـ"بانتظار إجرائي"
    expect(r).toHaveLength(0);
  });

  it("يرى مسودته الخاصة (السيناريو الحقيقي الذي كشف الخلل)", () => {
    const r = computeActionablePOs(
      { id: 9090247, role: "warehouse" },
      [
        po({ id: 1, poNumber: "PR-2026-0223", status: "draft", requestedById: 9090247 }),
        po({ id: 2, poNumber: "PR-2026-0222", status: "pending_estimate", requestedById: 9090247 }),
      ],
      []
    );
    expect(r).toHaveLength(1);
    expect(r[0].poNumber).toBe("PR-2026-0223");
  });
});


describe("طلب تغيير المندوب — بانتظار مدير الصيانة", () => {
  const changeItem = {
    purchaseOrderId: 1,
    status: "pending",
    delegateId: 10,
    batchId: null,
    delegateChangeRequestedAt: "2026-08-01T12:00:00.000Z",
  };

  it("يظهر لمدير الصيانة وowner/admin كإجراء اختيار مندوب", () => {
    for (const role of ["maintenance_manager", "owner", "admin"]) {
      const result = computeActionablePOs(
        { id: 99, role },
        [po({ status: "pending_estimate" })],
        [changeItem]
      );
      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe("طلب تغيير مندوب — 1 من 1 أصناف");
      expect(result[0].actionLabel).toBe("اختيار مندوب");
    }
  });

  it("لا يظهر للمندوب القديم كطلب تسعير إذا كان كل عمله مجمدًا", () => {
    const result = computeActionablePOs(
      { id: 10, role: "delegate" },
      [po({ status: "pending_estimate" })],
      [changeItem]
    );
    expect(result).toHaveLength(0);
  });

  it("يبقى طلب التسعير ظاهرًا للمندوب إذا لديه صنف آخر غير مجمد", () => {
    const result = computeActionablePOs(
      { id: 10, role: "delegate" },
      [po({ status: "pending_estimate" })],
      [
        changeItem,
        { purchaseOrderId: 1, status: "pending", delegateId: 10, batchId: null, delegateChangeRequestedAt: null },
      ]
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("بانتظار تسعيرك");
  });
});

describe("دفعات بلا أصناف فعّالة — لا تظهر في بانتظار إجرائي", () => {
  for (const [role, status] of [
    ["accountant", "pending_accounting"],
    ["senior_management", "pending_management"],
    ["owner", "pending_management"],
  ] as const) {
    it(`${role}: طلب ${status} وكل أصنافه cancelled/rejected لا يظهر كإجراء`, () => {
      const result = computeActionablePOs(
        { id: 10, role },
        [po({ status })],
        [
          { purchaseOrderId: 1, status: "cancelled", batchId: 1 },
          { purchaseOrderId: 1, status: "rejected", batchId: 1 },
        ]
      );
      expect(result).toHaveLength(0);
    });
  }
});

describe("المندوب — مصدر الحقيقة هو حالة أصنافه لا حالة PR العامة", () => {
  it("partial_purchase + صنف pending للمندوب يظهر كتسعير لا كإكمال شراء", () => {
    const result = computeActionablePOs(
      { id: 3540173, role: "delegate" },
      [po({ id: 497, poNumber: "PR-2026-60497", status: "partial_purchase" })],
      [
        { purchaseOrderId: 497, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 497, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 497, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 497, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 497, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 497, status: "pending", delegateId: 3540173, batchId: null, delegateChangeRequestedAt: null },
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      poNumber: "PR-2026-60497",
      reason: "بانتظار تسعيرك",
      actionLabel: "تسعير",
      actionMode: "estimate",
    });
  });

  it("partial_purchase لا يظهر للمندوب إذا كان الصنف المتبقي يخص مندوبًا آخر", () => {
    const result = computeActionablePOs(
      { id: 3540173, role: "delegate" },
      [po({ id: 491, poNumber: "PR-2026-60491", status: "partial_purchase" })],
      [
        { purchaseOrderId: 491, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 491, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 491, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 491, status: "delivered_to_warehouse", delegateId: 3540173 },
        { purchaseOrderId: 491, status: "pending", delegateId: 18090006, batchId: null, delegateChangeRequestedAt: null },
      ]
    );

    expect(result).toHaveLength(0);
  });

  it("partial_purchase + صنف approved للمندوب يظهر كإكمال شراء", () => {
    const result = computeActionablePOs(
      { id: 3540173, role: "delegate" },
      [po({ id: 517, poNumber: "PR-2026-0517", status: "partial_purchase" })],
      [
        { purchaseOrderId: 517, status: "approved", delegateId: 3540173 },
        { purchaseOrderId: 517, status: "delivered_to_warehouse", delegateId: 3540173 },
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reason: "بانتظار إكمال الشراء",
      actionLabel: "إكمال الشراء",
      actionMode: "purchase",
    });
  });

  it("إذا اجتمع التسعير والشراء لنفس المندوب يظهر الطلب مرة واحدة كعمل مختلط", () => {
    const result = computeActionablePOs(
      { id: 10, role: "delegate" },
      [po({ status: "partial_purchase" })],
      [
        { purchaseOrderId: 1, status: "pending", delegateId: 10, batchId: null, delegateChangeRequestedAt: null },
        { purchaseOrderId: 1, status: "approved", delegateId: 10 },
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionLabel: "فتح",
      actionMode: "mixed",
    });
  });

  it("صنف pending يبقى ظاهرًا للتسعير حتى لو تقدمت حالة PR بسبب دفعة أخرى", () => {
    const result = computeActionablePOs(
      { id: 10, role: "delegate" },
      [po({ status: "pending_accounting" })],
      [
        { purchaseOrderId: 1, status: "pending", delegateId: 10, batchId: null, delegateChangeRequestedAt: null },
        { purchaseOrderId: 1, status: "estimated", delegateId: 20, batchId: 7, delegateChangeRequestedAt: null },
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reason: "بانتظار تسعيرك",
      actionMode: "estimate",
    });
  });
});
