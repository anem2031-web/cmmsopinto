import type { YourWorkAction, YourWorkKind } from "@shared/your-work";

export type YourWorkLanguage = "ar" | "en" | "ur";
type Copy = {
  title: string; overdue: string; required: string; number: string; transaction: string; action: string;
  arrived: string; overdueDuration: string; elapsed: string; loading: string; loadError: string;
  noOverdue: string; noRequired: string; noWork: string; denied: string; unknownTime: string;
  greeting: (name: string) => string; summary: (overdue: number, required: number) => string;
  actions: Record<YourWorkAction, string>; kinds: Record<YourWorkKind, string>;
};
const ar: Copy = {
  title: "أعمالك", overdue: "المتأخرة عليك", required: "مطلوب منك إجراء", number: "م",
  transaction: "المعاملة", action: "المطلوب منك", arrived: "وصلت إليك", overdueDuration: "مدة التأخير", elapsed: "منذ الوصول",
  loading: "جارٍ تحميل أعمالك…", loadError: "تعذر تحميل أعمالك. يرجى المحاولة مجددًا.",
  noOverdue: "لا توجد أعمال متأخرة عليك.", noRequired: "لا توجد أعمال أخرى تنتظر إجراءك حاليًا.",
  noWork: "لا توجد أعمال تنتظر إجراءك حاليًا.", denied: "هذه الصفحة غير متاحة لحسابك.", unknownTime: "غير مسجل",
  greeting: name => name ? `مرحبًا، ${name} 👋` : "مرحبًا بك 👋",
  summary: (overdue, required) => {
    const work = (value: number) => value === 1 ? "عمل" : value === 2 ? "عملان" : `${value} ${value <= 10 ? "أعمال" : "عملًا"}`;
    return `لديك ${work(overdue)} ${overdue === 1 ? "متأخر" : overdue === 2 ? "متأخران" : "متأخرة"} و${work(required)} ${required === 1 ? "ينتظر" : required === 2 ? "ينتظران" : "تنتظر"} إجراءك.`;
  },
  actions: {
    material_issue: "صرف المواد للفني", material_resolve: "تحديد المادة ووحدتها",
    purchase_draft: "إكمال وإرسال مسودة طلب الشراء", material_link: "ربط سند الصرف بالصيانة المجدولة",
    purchase_review: "مراجعة طلب الشراء", purchase_revision: "تعديل الصنف", purchase_delegate_change: "مراجعة تغيير المندوب", purchase_cancel_review: "مراجعة إلغاء الشراء",
    purchase_accounting: "اعتماد الحسابات", purchase_management: "اعتماد الإدارة العليا", purchase_receive: "استلام المشتريات", purchase_deliver: "تسليم الصنف",
    ticket_path_select: "اختيار مسار الصيانة", it_ticket_claim: "استلام بلاغ تقنية المعلومات", it_ticket_execute: "بدء تنفيذ مهمة تقنية المعلومات", ticket_promote: "تحويل المهمة إلى تذكرة تنفيذ",
    ticket_triage: "الفرز والتصنيف", ticket_plan: "إنشاء مهام الجهة", ticket_assign: "إسناد المهمة للفريق", ticket_inspection_review: "مراجعة نتيجة الفحص", ticket_work_review: "اعتماد نتيجة الفريق",
    ticket_blocker: "معالجة العائق", ticket_external_review: "مراجعة مسار الصيانة الخارجية", ticket_close: "إغلاق البلاغ", ticket_confirm: "تأكيد إتمام البلاغ",
    external_prepare: "تجهيز الأصل للصيانة الخارجية", external_receive: "استلام الأصل من الصيانة الخارجية", external_handover: "تسليم الأصل للفني",
    settlement_prepare: "تعديل مسودة التسوية", settlement_correct: "تصحيح الجرد الأصلي", settlement_review: "مراجعة التسوية",
    pmv2_review: "مراجعة نتيجة الصيانة المجدولة", pmv2_blocker: "معالجة عائق الصيانة المجدولة", material_provide: "توفير المواد", material_return: "تأكيد استلام المرتجع",
    operational_purchase: "إنشاء شراء للنقص التشغيلي", operational_approve: "اعتماد الصرف التشغيلي", operational_issue: "صرف المواد التشغيلي", return_followup: "متابعة مرتجع المورد", return_refund: "تأكيد استرداد قيمة المرتجع",
    idea_classify: "فرز وتصنيف فكرة التحسين", idea_study: "دراسة فكرة التحسين", idea_decide: "اتخاذ قرار بشأن فكرة التحسين", it_purchase_submit: "إرسال احتياج شراء تقنية المعلومات", it_purchase_create: "إنشاء طلب شراء لاحتياج تقنية المعلومات",
    idea_review: "مراجعة فكرة التحسين", it_purchase_review: "مراجعة احتياج شراء تقنية المعلومات", specification_review: "مراجعة مطابقة المواصفات",
  },
  kinds: { purchase: "طلب شراء", pricing_bundle: "حزمة تسعير", pricing_submission: "دفعة تسعير", ticket: "بلاغ صيانة", team_task: "مهمة فريق", external: "صيانة خارجية", settlement: "تسوية جرد", pmv2: "صيانة مجدولة", operational: "صرف تشغيلي", supplier_return: "مرتجع مورد", idea: "فكرة تحسين", it_purchase_need: "احتياج شراء تقنية المعلومات", specification: "مطابقة المواصفات" },
};
const en: Copy = {
  title: "Your work", overdue: "Overdue from you", required: "Action required from you", number: "No.",
  transaction: "Transaction", action: "Your action", arrived: "Reached you", overdueDuration: "Time overdue", elapsed: "Since arrival",
  loading: "Loading your work…", loadError: "Your work could not be loaded. Please try again.",
  noOverdue: "You have no overdue work.", noRequired: "No other work currently needs your action.",
  noWork: "No work currently needs your action.", denied: "This page is not available to your account.", unknownTime: "Not recorded",
  greeting: name => name ? `Welcome, ${name} 👋` : "Welcome 👋",
  summary: (overdue, required) => `You have ${overdue} overdue work item${overdue === 1 ? "" : "s"} and ${required} item${required === 1 ? "" : "s"} awaiting your action.`,
  actions: {
    material_issue: "Issue materials to technician", material_resolve: "Identify material and unit",
    purchase_draft: "Complete and submit purchase draft", material_link: "Link issue document to scheduled maintenance",
    purchase_review: "Review purchase request", purchase_revision: "Revise item", purchase_delegate_change: "Review delegate change", purchase_cancel_review: "Review purchase cancellation",
    purchase_accounting: "Accounting approval", purchase_management: "Senior management approval", purchase_receive: "Receive purchases", purchase_deliver: "Hand over item",
    ticket_path_select: "Select maintenance route", it_ticket_claim: "Claim IT ticket", it_ticket_execute: "Start IT task execution", ticket_promote: "Create execution ticket from task",
    ticket_triage: "Triage and classify", ticket_plan: "Create department tasks", ticket_assign: "Assign task to team", ticket_inspection_review: "Review inspection result", ticket_work_review: "Approve team result",
    ticket_blocker: "Resolve blocker", ticket_external_review: "Review external maintenance route", ticket_close: "Close ticket", ticket_confirm: "Confirm ticket completion",
    external_prepare: "Prepare asset for external maintenance", external_receive: "Receive asset after external maintenance", external_handover: "Hand asset to technician",
    settlement_prepare: "Revise settlement draft", settlement_correct: "Correct original count", settlement_review: "Review settlement",
    pmv2_review: "Review scheduled maintenance result", pmv2_blocker: "Resolve scheduled maintenance blocker", material_provide: "Provide materials", material_return: "Confirm material return receipt",
    operational_purchase: "Create purchase for operational shortage", operational_approve: "Approve operational issue", operational_issue: "Issue operational materials", return_followup: "Follow up supplier return", return_refund: "Confirm return refund",
    idea_classify: "Classify improvement idea", idea_study: "Study improvement idea", idea_decide: "Decide on improvement idea", it_purchase_submit: "Submit IT purchase need", it_purchase_create: "Create purchase request for IT need",
    idea_review: "Review improvement idea", it_purchase_review: "Review IT purchase need", specification_review: "Review specification compliance",
  },
  kinds: { purchase: "Purchase request", pricing_bundle: "Pricing bundle", pricing_submission: "Pricing submission", ticket: "Maintenance ticket", team_task: "Team task", external: "External maintenance", settlement: "Inventory settlement", pmv2: "Scheduled maintenance", operational: "Operational issue", supplier_return: "Supplier return", idea: "Improvement idea", it_purchase_need: "IT purchase need", specification: "Specification review" },
};
const ur: Copy = {
  title: "آپ کے کام", overdue: "آپ کے تاخیر شدہ کام", required: "آپ کی کارروائی درکار ہے", number: "نمبر",
  transaction: "معاملہ", action: "آپ سے مطلوب کارروائی", arrived: "آپ تک پہنچا", overdueDuration: "تاخیر کی مدت", elapsed: "پہنچنے کے بعد کی مدت",
  loading: "آپ کے کام لوڈ ہو رہے ہیں…", loadError: "آپ کے کام لوڈ نہیں ہوسکے۔ براہ کرم دوبارہ کوشش کریں۔",
  noOverdue: "آپ کا کوئی کام تاخیر کا شکار نہیں۔", noRequired: "فی الحال کسی اور کام پر آپ کی کارروائی درکار نہیں۔",
  noWork: "فی الحال کسی کام پر آپ کی کارروائی درکار نہیں۔", denied: "یہ صفحہ آپ کے اکاؤنٹ کے لیے دستیاب نہیں۔", unknownTime: "درج نہیں",
  greeting: name => name ? `خوش آمدید، ${name} 👋` : "خوش آمدید 👋",
  summary: (overdue, required) => `آپ کے ${overdue} کام تاخیر کا شکار ہیں اور ${required} کام آپ کی کارروائی کے منتظر ہیں۔`,
  actions: {
    material_issue: "ٹیکنیشن کو مواد جاری کریں", material_resolve: "مواد اور اکائی کی شناخت کریں",
    purchase_draft: "خریداری کا مسودہ مکمل کرکے بھیجیں", material_link: "اجرا کی دستاویز شیڈول مینٹیننس سے منسلک کریں",
    purchase_review: "خریداری کی درخواست کا جائزہ", purchase_revision: "شے میں ترمیم", purchase_delegate_change: "نمائندے کی تبدیلی کا جائزہ", purchase_cancel_review: "خریداری کی منسوخی کا جائزہ",
    purchase_accounting: "حسابات کی منظوری", purchase_management: "اعلیٰ انتظامیہ کی منظوری", purchase_receive: "خریدی گئی اشیاء وصول کریں", purchase_deliver: "شے حوالے کریں",
    ticket_path_select: "مینٹیننس کا راستہ منتخب کریں", it_ticket_claim: "آئی ٹی ٹکٹ وصول کریں", it_ticket_execute: "آئی ٹی کام شروع کریں", ticket_promote: "کام سے عملی ٹکٹ بنائیں",
    ticket_triage: "چھانٹی اور درجہ بندی", ticket_plan: "شعبے کے کام بنائیں", ticket_assign: "کام ٹیم کو تفویض کریں", ticket_inspection_review: "معائنے کے نتیجے کا جائزہ", ticket_work_review: "ٹیم کے نتیجے کی منظوری",
    ticket_blocker: "رکاوٹ حل کریں", ticket_external_review: "بیرونی مینٹیننس راستے کا جائزہ", ticket_close: "ٹکٹ بند کریں", ticket_confirm: "ٹکٹ کی تکمیل کی تصدیق",
    external_prepare: "اثاثہ بیرونی مینٹیننس کے لیے تیار کریں", external_receive: "بیرونی مینٹیننس سے اثاثہ وصول کریں", external_handover: "اثاثہ ٹیکنیشن کو حوالے کریں",
    settlement_prepare: "تصفیے کے مسودے میں ترمیم", settlement_correct: "اصل گنتی درست کریں", settlement_review: "تصفیے کا جائزہ",
    pmv2_review: "مقررہ مینٹیننس کے نتیجے کا جائزہ", pmv2_blocker: "مقررہ مینٹیننس کی رکاوٹ حل کریں", material_provide: "مواد فراہم کریں", material_return: "واپس آنے والے مواد کی وصولی کی تصدیق",
    operational_purchase: "آپریشنل کمی کے لیے خریداری بنائیں", operational_approve: "آپریشنل اجرا کی منظوری", operational_issue: "آپریشنل مواد جاری کریں", return_followup: "سپلائر کی واپسی کی پیروی", return_refund: "واپسی کی رقم کی وصولی کی تصدیق",
    idea_classify: "بہتری کی تجویز کی درجہ بندی", idea_study: "بہتری کی تجویز کا مطالعہ", idea_decide: "بہتری کی تجویز پر فیصلہ", it_purchase_submit: "آئی ٹی خریداری کی ضرورت بھیجیں", it_purchase_create: "آئی ٹی ضرورت کے لیے خریداری کی درخواست بنائیں",
    idea_review: "بہتری کی تجویز کا جائزہ", it_purchase_review: "آئی ٹی خریداری کی ضرورت کا جائزہ", specification_review: "تفصیلات کی مطابقت کا جائزہ",
  },
  kinds: { purchase: "خریداری کی درخواست", pricing_bundle: "قیمتوں کا پیکیج", pricing_submission: "قیمتوں کی کھیپ", ticket: "مینٹیننس ٹکٹ", team_task: "ٹیم کا کام", external: "بیرونی مینٹیننس", settlement: "انوینٹری کا تصفیہ", pmv2: "مقررہ مینٹیننس", operational: "آپریشنل اجرا", supplier_return: "سپلائر کو واپسی", idea: "بہتری کی تجویز", it_purchase_need: "آئی ٹی خریداری کی ضرورت", specification: "تفصیلات کی مطابقت" },
};
export const yourWorkCopy = (language: string): Copy => language === "en" ? en : language === "ur" ? ur : ar;

export function yourWorkDate(value: number | null, missing: string): string {
  if (value == null || !Number.isFinite(value)) return missing;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", calendar: "gregory", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(value));
  const field = (name: string) => parts.find(part => part.type === name)?.value || "";
  return `${field("year")}-${field("month")}-${field("day")}-${field("hour")}:${field("minute")}`;
}
export function yourWorkDuration(ms: number | null, language: string, missing: string): string {
  if (ms == null || !Number.isFinite(ms)) return missing;
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (!minutes) return language === "en" ? "Less than a minute" : language === "ur" ? "ایک منٹ سے کم" : "أقل من دقيقة";
  const values = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60];
  const single = ["يوم", "ساعة", "دقيقة"], dual = ["يومان", "ساعتان", "دقيقتان"], plural = ["أيام", "ساعات", "دقائق"];
  const units = language === "ur" ? ["دن", "گھنٹے", "منٹ"] : ["day", "hour", "minute"];
  const result = values.flatMap((value, index) => !value ? [] : [language === "ar"
    ? value === 1 ? single[index] : value === 2 ? dual[index] : `${value} ${value <= 10 ? plural[index] : single[index]}`
    : `${value} ${units[index]}${language === "en" && value !== 1 ? "s" : ""}`]).slice(0, 2);
  return result.join(language === "ar" ? " و" : language === "ur" ? " اور " : " and ");
}
