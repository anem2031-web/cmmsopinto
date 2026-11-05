const ar = {
  title: "مركز المرتجعات",
  description: "تابع المرتجعات حسب نوعها، واستعرض الإجراءات والسندات من مكان واحد.",
  newReturn: "مرتجع جديد",
  panelsLabel: "أقسام مركز المرتجعات",
  materialsLabel: "مصدر مرتجعات المواد",
  searchLabel: "بحث في القائمة المعروضة",
  searchPlaceholder: "ابحث برقم المعاملة أو الصنف أو الاسم…",
  searchHint: "البحث يصفّي السجلات المعروضة هنا. في القوائم المرقمة، يقتصر على الصفحة الحالية.",
  clearSearch: "مسح البحث",
  documentCategory: "نوع سند المرتجع",
  documentCategories: { all: "جميع السندات", supplier: "مرتجعات الموردين", recipient: "مرتجعات الجهات والفنيين" },
  loading: "جارٍ التحقق من الصلاحية…",
  forbidden: "ليست لديك صلاحية الوصول إلى مركز المرتجعات.",
  panels: {
    suppliers: { title: "الموردون والتعويض", description: "تسليم المرتجع للمندوب ومتابعة الاستبدال أو الاسترداد، مع الجارية والمكتملة." },
    materials: { title: "مرتجعات الفنيين والفرق", description: "استلام المواد المرتجعة من أعمال الصيانة والمهام والصرف التشغيلي." },
    specifications: { title: "مرفوضات المواصفات", description: "الأصناف المرفوضة في المطابقة والتي تنتظر بدء الإرجاع للمورد." },
    documents: { title: "سندات المرتجعات", description: "استعراض سندات المرتجعات المحفوظة وطباعتها." },
  },
  sources: { tickets: "تذاكر الصيانة", pmv2: "مهام PMV2", operational: "الصرف التشغيلي" },
};
type ReturnsCenterLabels = typeof ar;

const en: ReturnsCenterLabels = {
  title: "Returns center",
  description: "Follow returns by type and access their actions and documents in one place.",
  newReturn: "New return",
  panelsLabel: "Returns center sections",
  materialsLabel: "Material return source",
  searchLabel: "Search the displayed list",
  searchPlaceholder: "Search by reference, item or name…",
  searchHint: "Search filters the records displayed here. For paginated lists, it applies to the current page.",
  clearSearch: "Clear search",
  documentCategory: "Return document type",
  documentCategories: { all: "All documents", supplier: "Supplier returns", recipient: "Recipient and technician returns" },
  loading: "Checking access…",
  forbidden: "You cannot access the returns center.",
  panels: {
    suppliers: { title: "Suppliers and replacements", description: "Hand returns to the delegate and follow replacements or refunds, including active and completed cases." },
    materials: { title: "Technician and team returns", description: "Receive materials returned from maintenance work, tasks and operational issues." },
    specifications: { title: "Specification rejections", description: "Items rejected during specification review and awaiting a supplier return." },
    documents: { title: "Return documents", description: "View and print saved return documents." },
  },
  sources: { tickets: "Maintenance tickets", pmv2: "PMV2 tasks", operational: "Operational issues" },
};

const ur: ReturnsCenterLabels = {
  title: "واپسی مرکز",
  description: "قسم کے مطابق واپسی کی نگرانی کریں اور کارروائیوں اور دستاویزات کو ایک جگہ دیکھیں۔",
  newReturn: "نئی واپسی",
  panelsLabel: "واپسی مرکز کے حصے",
  materialsLabel: "مواد کی واپسی کا ماخذ",
  searchLabel: "ظاہر فہرست میں تلاش",
  searchPlaceholder: "حوالہ، شے یا نام سے تلاش کریں…",
  searchHint: "تلاش یہاں ظاہر ریکارڈ چھانٹتی ہے۔ صفحہ وار فہرست میں صرف موجودہ صفحہ تلاش ہوتا ہے۔",
  clearSearch: "تلاش صاف کریں",
  documentCategory: "واپسی دستاویز کی قسم",
  documentCategories: { all: "تمام دستاویزات", supplier: "سپلائر کی واپسی", recipient: "وصول کنندہ اور ٹیکنیشن کی واپسی" },
  loading: "اجازت کی جانچ جاری ہے…",
  forbidden: "آپ کو واپسی مرکز تک رسائی کی اجازت نہیں ہے۔",
  panels: {
    suppliers: { title: "سپلائر اور متبادل", description: "مندوب کو واپسی دیں اور جاری یا مکمل متبادل اور رقم کی واپسی دیکھیں۔" },
    materials: { title: "ٹیکنیشن اور ٹیم کی واپسی", description: "مرمت، کاموں اور عملی اجرا سے واپس آنے والا مواد وصول کریں۔" },
    specifications: { title: "تفصیلات کی مسترد اشیا", description: "جانچ میں مسترد اشیا جن کی سپلائر کو واپسی شروع ہونا باقی ہے۔" },
    documents: { title: "واپسی کی دستاویزات", description: "محفوظ واپسی کی دستاویزات دیکھیں اور پرنٹ کریں۔" },
  },
  sources: { tickets: "مرمت کے ٹکٹ", pmv2: "PMV2 کام", operational: "عملی اجرا" },
};

export function returnsCenterLabels(language: string): ReturnsCenterLabels {
  return language === "en" ? en : language === "ur" ? ur : ar;
}
