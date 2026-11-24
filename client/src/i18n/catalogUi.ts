import { localizeApiError } from "./apiError";

/** Replace placeholders once; user data containing braces is never expanded again. */
export function formatCatalogText(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  );
}

const catalogErrors: Record<string, string> = {
  "كود التصنيف مطلوب": "Category code is required.",
  "كود الصنف مطلوب": "Item code is required.",
  "الحساب غير نشط": "This account is inactive.",
  "يمكن لمدير تقنية المعلومات إضافة أصناف جديدة ضمن تصنيف تقنية المعلومات (10) وتفرعاته فقط":
    "IT managers can create new items only under Information Technology (10) and its subcategories.",
  "يرجى رفع صورة صالحة للصنف من حسابك":
    "Upload a valid item image from your account.",
  "صورة الصنف إلزامية؛ يرجى إضافة صورة قبل الحفظ":
    "An item image is required. Add an image before saving.",
  "مسار تصنيف الكتالوج يحتوي على علاقة دائرية غير صالحة":
    "The category hierarchy contains a circular link. Review the parent category.",
  "التصنيف المختار أو أحد آبائه غير موجود":
    "The selected category or one of its parents no longer exists.",
  "تعذر التحقق من مسار التصنيف بالكامل":
    "The complete category path could not be verified. Refresh and try again.",
  "التصنيف الأب غير موجود": "The parent category no longer exists.",
  "تعذر توليد كود فرعي ضمن الحد الأقصى لطول الكود":
    "A child code cannot be generated within the maximum code length.",
  "تعذر توليد كود الصنف": "The item code could not be generated.",
  "الحد الأقصى للمستويات هو 6":
    "The category hierarchy supports a maximum of 6 levels.",
  "كود التصنيف الرئيسي يبدأ من 01، وكل مقطع يجب أن يكون خانتين على الأقل":
    "Root category codes start at 01. Each code segment must contain at least two digits.",
  "مدير الإنشاءات لا يملك صلاحية تعطيل التصنيفات":
    "The Construction Manager cannot deactivate categories.",
  "التصنيف غير موجود": "The category no longer exists.",
  "لا يمكن تغيير كود التصنيف من التعديل العادي. استخدم «نقل / إعادة هيكلة» لإعادة ترقيم الفرع بأمان.":
    "The category code cannot be changed in this form. Use Move / restructure to renumber the branch.",
  "التصنيف معطّل بالفعل": "The category is already inactive.",
  "التصنيف نشط بالفعل": "The category is already active.",
  "صلاحية هذا الدور تشمل تعديل الأصناف وتعطيلها دون إعادة تفعيلها":
    "Your role can edit and deactivate items, but cannot reactivate them.",
  "صنف الكتالوج غير موجود": "The catalog item no longer exists.",
  "الصنف معطّل بالفعل": "The item is already inactive.",
  "الصنف نشط بالفعل": "The item is already active.",
  "مرشح الصنف غير موجود أو تمت معالجته":
    "The item candidate no longer exists or has already been processed. Refresh the list.",
  "أحد المرشحين غير موجود أو تمت معالجته؛ حدّث القائمة":
    "A candidate no longer exists or has already been processed. Refresh the list.",
  "أحد المرشحين المضمومين تمت معالجته بالفعل؛ حدّث قائمة الأصناف الجديدة":
    "A grouped candidate has already been processed. Refresh the new items list.",
  "لا يمكن دمج Candidate مع نفسه": "A candidate cannot be merged with itself.",
  "المرشح الأساسي يجب أن يكون أحد المرشحين المحددين":
    "The primary candidate must be one of the selected candidates.",
  "لا يمكن مقارنة Candidate مع نفسه":
    "A candidate cannot be compared with itself.",
  "تم اعتماد هذين المرشحين مسبقاً كنفس الصنف. فك الدمج يحتاج إجراء إداري منفصل.":
    "These candidates have already been confirmed as the same item. Unmerging requires a separate administrative action.",
  "صنف الكتالوج المختار غير موجود أو غير نشط":
    "The selected catalog item no longer exists or is inactive.",
  "تمت معالجة أحد المرشحين المضمومين بواسطة مستخدم آخر؛ حدّث القائمة":
    "Another user has processed a grouped candidate. Refresh the list.",
  "تمت معالجة أحد المرشحين المضمومين بواسطة مستخدم آخر؛ أُلغي إنشاء الصنف وارجع لتحديث القائمة":
    "Another user has processed a grouped candidate. Item creation was cancelled; refresh the list.",
  "وحدة القياس غير موجودة": "The unit of measure no longer exists.",
  "وحدة القياس معطّلة بالفعل": "The unit of measure is already inactive.",
  "وحدة القياس نشطة بالفعل": "The unit of measure is already active.",
  "لا يمكن نقل التصنيف إلى نفسه": "A category cannot be moved under itself.",
  "لا يمكن نقل التصنيف إلى أحد فروعه":
    "A category cannot be moved under one of its descendants.",
  "لا يمكن إعادة هيكلة تصنيف غير نشط":
    "An inactive category cannot be restructured.",
  "لا يمكن نقل تصنيف غير نشط": "An inactive category cannot be moved.",
  "المورد غير موجود": "The supplier no longer exists.",
  "المورد معطّل بالفعل": "The supplier is already inactive.",
  "المورد نشط بالفعل": "The supplier is already active.",
  "لا يمكن حذف المورد لوجود ارتباطات":
    "This supplier has linked records and cannot be deleted.",
};
const catalogErrorPatterns: Array<[RegExp, string]> = [
  [/^كود التصنيف غير صالح: (.+)$/, "Invalid category code: $1."],
  [
    /^كود التصنيف (.+) لا يتبع الأب (.+) مباشرة$/,
    "Category code $1 must be a direct child of $2.",
  ],
  [
    /^الاسم العربي مطلوب للتصنيف: (.+)$/,
    "An Arabic name is required for category $1.",
  ],
  [/^كود مكرر في التصنيفات: (.+)$/, "Duplicate category code: $1."],
  [
    /^كود الأب "(.+)" للتصنيف "(.+)" غير موجود في الملف \(قد يكون موجوداً في قاعدة البيانات\)$/,
    'Parent code "$1" for category "$2" is missing from the file; it may already exist in the database.',
  ],
  [
    /^الاسم العربي مطلوب للصنف: (.+)$/,
    "An Arabic name is required for item $1.",
  ],
  [
    /^كود التصنيف مطلوب للصنف: (.+)$/,
    "A category code is required for item $1.",
  ],
  [/^كود مكرر في الأصناف: (.+)$/, "Duplicate item code: $1."],
  [
    /^التصنيف "(.+)" للصنف "(.+)" غير موجود في الملف$/,
    'Category "$1" for item "$2" is missing from the file.',
  ],
  [/^الكود (.+) مستخدم مسبقاً$/, "Code $1 is already in use."],
  [
    /^الكود (.+) كود تاريخي محجوز ولا يمكن إعادة استخدامه$/,
    "Code $1 is reserved by historical records and cannot be reused.",
  ],
  [
    /^لا يمكن استخدام التصنيف غير النشط «(.+)» في علاقة جديدة$/,
    "Category “$1” is inactive and cannot be used for a new link.",
  ],
  [
    /^وحدة القياس «(.+)» غير موجودة في تبويب الوحدات$/,
    "Unit “$1” does not exist in the Units tab.",
  ],
  [
    /^وحدة القياس «(.+)» معطّلة ولا يمكن استخدامها في علاقة جديدة$/,
    "Unit “$1” is inactive and cannot be used for a new link.",
  ],
  [
    /^لا يمكن إضافة صنف مباشرة إلى «(.+)» لأنه تصنيف رئيسي وله تفرعات. اختر آخر مستوى في الشجرة.$/,
    "An item cannot be added directly to “$1” because this category has child categories. Select a leaf category.",
  ],
  [
    /^كود التصنيف الفرعي يجب أن يكون بصيغة (.+)$/,
    "The child category code must use this format: $1.",
  ],
  [
    /^كود الصنف يجب أن يكون بصيغة (.+) \(كود التصنيف-تسلسل رقمي\)$/,
    "The item code must use this format: $1 (category code followed by a numeric sequence).",
  ],
  [
    /^عند تغيير التصنيف يجب أن يكون كود الصنف بصيغة (.+) \(كود التصنيف-تسلسل رقمي\)$/,
    "When changing category, the item code must use this format: $1 (category code followed by a numeric sequence).",
  ],
  [
    /^كود الصنف يجب أن يبدأ بكود التصنيف المختار (.+)- ثم تسلسل رقمي \(مثال (.+)\)$/,
    "The item code must start with category code $1-, followed by a numeric sequence (for example, $2).",
  ],
  [
    /^لا يمكن الحذف — يوجد (.+) تصنيف فرعي مرتبط$/,
    "Cannot deactivate: $1 child categories are linked.",
  ],
  [
    /^لا يمكن الحذف — يوجد (.+) صنف مرتبط$/,
    "Cannot deactivate: $1 items are linked.",
  ],
  [
    /^Candidate #(\d+) تابع لنفس الصنف مع Candidate #(\d+). احسم المرشح الأساسي أولاً.$/,
    "Candidate #$1 represents the same item as candidate #$2. Process the primary candidate first.",
  ],
  [
    /^هذا المرشح تم ضمه إلى Candidate #(\d+). راجع المرشح الأساسي.$/,
    "This candidate was grouped under candidate #$1. Review the primary candidate.",
  ],
  [
    /^هذا المرشح تابع لـCandidate #(\d+). اعتمد المرشح الأساسي أولاً.$/,
    "This candidate belongs to candidate #$1. Approve the primary candidate first.",
  ],
  [
    /^Candidate #(\d+) تابع بالفعل لـCandidate #(\d+)(?:؛ اختر المرشح الأساسي الحقيقي)?$/,
    "Candidate #$1 already belongs to candidate #$2. Select the actual primary candidate.",
  ],
  [
    /^Candidate #(\d+) هو المرشح الأساسي لمجموعة أخرى. اختره كمرشح أساسي أو احسم مجموعته أولاً.$/,
    "Candidate #$1 is the primary candidate of another group. Select it as primary or process its group first.",
  ],
  [
    /^يوجد صنف مطابق في الكتالوج \(#(\d+)\)؛ اربط المرشح بالصنف الموجود بدلاً من إنشاء نسخة جديدة$/,
    "Matching catalog item #$1 already exists. Link the candidate to it instead of creating a duplicate.",
  ],
  [
    /^يوجد مرشح آخر بانتظار المراجعة قد يمثل نفس الصنف \(Candidate #(\d+)\). احسم المرشح الآخر أولاً أو عدّل بيانات Master إذا كان هذا صنفاً مختلفاً فعلاً.$/,
    "Pending candidate #$1 may represent the same item. Process it first, or correct the master data if this is a different item.",
  ],
];

/** Presentation only. Keep original server errors and workflow decisions unchanged. */
export function getCatalogError(
  error: unknown,
  language: string,
  fallback: string
): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message ?? "")
        : "";
  const message = raw.trim();
  if (!message) return fallback;
  if (language !== "en") return message;
  // Technical diagnostics belong to server logs, never a catalog dialog or toast.
  if (
    /Failed query:|SQLSTATE|ER_[A-Z_]+|ECONN|SELECT\s.+\sFROM|INSERT\s+INTO|UPDATE\s.+\sSET|DELETE\s+FROM/i.test(
      message
    )
  )
    return fallback;
  if (catalogErrors[message]) return catalogErrors[message];
  for (const [pattern, translation] of catalogErrorPatterns) {
    if (pattern.test(message)) return message.replace(pattern, translation);
  }
  if (/[\u0600-\u06ff]/.test(message)) {
    const translated = localizeApiError(message, "en");
    return translated ===
      "The operation could not be completed. Check the current stage and data, then try again."
      ? fallback
      : translated;
  }
  return message;
}
