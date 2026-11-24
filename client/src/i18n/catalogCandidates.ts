const ar = {
  reasonSupplierCode: "SKU معروف لهذا المورد",
  reasonSupplierName: "اسم معروف لهذا المورد",
  reasonSupplierSimilar: "اسم قريب من ذاكرة المورد",
  reasonCatalogName: "تطابق اسم الكتالوج",
  reasonLocal: "اقتراح بحث ذكي",
  reasonSemantic: "تشابه دلالي",
  reasonAi: "ترتيب دلالي بمساعدة AI",
  reasonFallback: "اقتراح كتالوج",
  linked: "تم حسم المرشح وربطه بصنف كتالوج موجود",
  notSameSaved:
    "تم تسجيل أن المرشحين ليسا نفس الصنف، ولن يعاد اقتراح هذا الزوج كتكرار.",
  noMatches: "لم يتم العثور على تطابق موثوق في الكتالوج أو بين المرشحين الجدد",
  namesRequired: "الاسم العربي والإنجليزي مطلوبان",
  categoryRequired: "يجب اختيار تصنيف للصنف",
  leafRequired:
    "لا يمكن إضافة صنف إلى تصنيف رئيسي. اختر آخر مستوى في شجرة التصنيف",
  categoryNoCode:
    "التصنيف النهائي المختار لا يحتوي على كود؛ لا يمكن توليد كود الصنف",
  codeFailed:
    "تعذر توليد كود الكتالوج لهذا التصنيف. راجع التصنيف ثم حاول مرة أخرى",
  loading: "جاري تحميل المرشحين...",
  heading: "إدخال الأصناف الجديدة إلى الكتالوج",
  headingHint:
    "أصناف استُلمت تشغيليًا كـ«صنف جديد» وتنتظر حسم Master Data. المراجعة هنا لا تعيد الاستلام ولا تغيّر الكميات أو التكلفة.",
  pending: "بانتظار المراجعة",
  searchLabel: "البحث في الأصناف الجديدة",
  search: "ابحث باسم الصنف بالعربية أو الإنجليزية…",
  empty: "لا توجد أصناف جديدة بانتظار المراجعة.",
  noSearchResults: "لا توجد أصناف مطابقة للبحث.",
  request: "طلب",
  invoice: "فاتورة",
  supplier: "المورد:",
  unitInline: "الوحدة:",
  checkDuplicates: "فحص التكرار",
  linkExisting: "ربط بموجود",
  approveNew: "اعتماد جديد",
  similarPending: "مرشحون جدد مشابهون — احسم أحدهم قبل اعتماد صنف جديد مكرر:",
  pendingHint: "هذه النتائج من Queue نفسها وليست أصناف كتالوج معتمدة بعد.",
  specificationDifferent: "يوجد اختلاف مواصفة؛ راجع قبل اعتبارهما نفس الصنف",
  sameItem: "نفس الصنف",
  notSameItem: "ليسا نفس الصنف",
  reviewCandidateHint: "ينقلك إلى المرشح المشابه ويشغل فحص التكرار له تلقائياً",
  existingMatches: "أقرب أصناف موجودة في الكتالوج — راجعها قبل إنشاء صنف جديد:",
  specificationWarning: "اختلاف مواصفة — لا تربط قبل المراجعة",
  choosePrimary: "اختيار المرشح الأساسي لنفس الصنف",
  choosePrimaryHint:
    "تم تحديد أن المرشحين يمثلان نفس الصنف. اختر أي Candidate يبقى كمرشح أساسي للمراجعة. هذا القرار لا ينشئ Catalog Item ولا يغير الاستلام أو المخزون أو التكلفة.",
  oldestSuggested: "الأقدم — مقترح",
  primaryHint:
    "بعد الاختيار سيبقى الـPrimary في Queue، ويختفي المرشح الآخر من قائمة العمل باعتباره تابعاً له. عند حسم الـPrimary لاحقاً سيُحسم التابع بنفس Catalog Item.",
  cancel: "إلغاء",
  savingDecision: "جاري حفظ القرار...",
  linkHeading: "ربط المرشح بصنف موجود",
  candidateLabel: "المرشح:",
  smartSuggestions: "الاقتراحات الذكية",
  specificationMismatch: "يوجد اختلاف في المواصفات",
  link: "ربط",
  manualSearch: "بحث يدوي في الكتالوج",
  manualSearchPlaceholder: "الاسم العربي أو الإنجليزي أو كود الكتالوج",
  searching: "جاري البحث...",
  approvalHeading: "اعتماد صنف جديد في الكتالوج",
  approvalHint:
    "قبل الاعتماد راجع اقتراحات التكرار. إنشاء Catalog Item هنا لا يعيد الاستلام ولا يغير الكميات أو التكلفة التاريخية.",
  strongCandidateWarning:
    "يوجد Candidate آخر قوي الشبه بانتظار المراجعة. احسمه أولاً أو صحح بيانات Master إذا كان هذا صنفاً مختلفاً فعلاً.",
  strongCatalogWarning:
    "يوجد تطابق محتمل قوي في الكتالوج. راجعه قبل إنشاء نسخة جديدة.",
  arabicName: "الاسم العربي *",
  englishName: "الاسم الإنجليزي *",
  englishNamePlaceholder: "اكتب الاسم الإنجليزي يدويًا",
  urduName: "الاسم الأردي",
  unit: "الوحدة",
  chooseUnit: "اختر الوحدة",
  manufacturer: "المصنع",
  catalogCode: "كود الكتالوج (تلقائي)",
  chooseFinalLevel: "اختر آخر مستوى في التصنيف",
  generatingCode: "جاري توليد الكود...",
  chooseFinalFirst: "اختر التصنيف النهائي أولاً",
  codeHint:
    "يولده النظام من كود التصنيف النهائي وآخر نمط ترقيم مستخدم داخله، ويعاد حسابه في Backend لحظة الاعتماد.",
  category: "التصنيف *",
  categoryHint:
    "اختر من نفس شجرة تصنيفات الكتالوج المستخدمة في تبويب «التصنيفات». يمكن إضافة الصنف فقط إلى آخر مستوى (تصنيف بلا تفرعات)، وسيتم حفظ نفس nodeId بدون إنشاء تصنيف موازٍ.",
  categorySearch: "ابحث داخل شجرة التصنيفات بالاسم أو الكود...",
  arabicDescription: "الوصف العربي",
  englishDescription: "الوصف الإنجليزي",
  checkingDuplicates: "جاري فحص التكرار...",
  approveAndAdd: "اعتماد وإضافة للكتالوج",
  collapseCategory: "طي التصنيف",
  expandCategory: "فتح التصنيف",
  parentCategoryTitle: "تصنيف رئيسي — افتح التفرعات واختر آخر مستوى",
  leafCategoryTitle: "تصنيف نهائي صالح لإضافة صنف",
  parentCategoryHint: "تصنيف رئيسي — اختر أحد التفرعات النهائية تحته",
  selectedCategory: "التصنيف المختار:",
  noCategories: "لا توجد تصنيفات نشطة.",
  noMatchingCategories: "لا يوجد تصنيف مطابق للبحث.",
  operationFailed: "تعذر إتمام الإجراء. يرجى المحاولة مجددًا.",
  approved: "تم اعتماد الصنف وإضافته إلى الكتالوج{code}",
  sameItemSaved:
    "تم اعتبار المرشحين نفس الصنف. Candidate #{id} هو المرشح الأساسي وسيُحسم الآخر معه تلقائياً.",
  similarFound: "تم العثور على {count} مرشح جديد مشابه؛ راجعه قبل الاعتماد",
  candidateMissing: "تعذر العثور على Candidate #{id} في قائمة الانتظار الحالية",
  notSameConfirm:
    "تأكيد أن Candidate #{first} وCandidate #{second} ليسا نفس الصنف؟\n\nسيحفظ النظام هذا القرار ولن يعيد اقتراح هذا الزوج كتكرار لاحقاً.",
  linkBookConfirm:
    "ربط «{candidate}» بدفتر صنف الكتالوج «{catalog}»؟\n\nيبقى كل سجل مخزون ولوت مستقلًا بكمياته ووحدته وتاريخه. لا تُدمج الأرصدة أو تُنقل الحركات عند الربط.",
  pendingDuplicateConfirm:
    "يوجد Candidate آخر بانتظار المراجعة بنسبة {score}% (#{id}).\n\nراجع المرشح الآخر أولاً لتجنب إنشاء صنفين مكررين. هل تريد البقاء في نموذج الاعتماد ومراجعة البيانات؟",
  catalogDuplicateConfirm:
    "يوجد تطابق محتمل قوي ({score}%) مع «{name}».\n\nهل راجعت الاقتراح وتؤكد أن المرشح صنف جديد مختلف فعلاً؟",
  shownCount: "{visible} من {total}",
  reviewCandidate: "راجع Candidate #{id}",
  linkConfirm:
    "ربط «{candidate}» بصنف الكتالوج «{catalog}»؟\n\nلن تتغير الكميات أو التكلفة أو الاستلام التاريخي في هذه الخطوة.",
};

const en: Record<keyof typeof ar, string> = {
  reasonSupplierCode: "Known SKU for this supplier",
  reasonSupplierName: "Known name for this supplier",
  reasonSupplierSimilar: "Similar name in supplier history",
  reasonCatalogName: "Catalog name match",
  reasonLocal: "Smart search suggestion",
  reasonSemantic: "Semantic similarity",
  reasonAi: "AI-assisted semantic ranking",
  reasonFallback: "Catalog suggestion",
  linked: "Candidate resolved and linked to an existing catalog item",
  notSameSaved:
    "Recorded as different items. This pair will not be suggested as duplicates again.",
  noMatches: "No reliable match found in the catalog or among new candidates",
  namesRequired: "Arabic and English names are required",
  categoryRequired: "Choose an item category",
  leafRequired:
    "Items cannot be added to a parent category. Choose a final level in the category tree.",
  categoryNoCode:
    "The selected final category has no code, so an item code cannot be generated.",
  codeFailed:
    "Could not generate a catalog code for this category. Check the category and try again.",
  loading: "Loading candidates...",
  heading: "Add new items to the catalog",
  headingHint:
    "Items received as new are awaiting catalog review. Reviewing them here does not repeat receipt or change quantities or costs.",
  pending: "Pending review",
  searchLabel: "Search new items",
  search: "Search by Arabic or English item name...",
  empty: "No new items pending review.",
  noSearchResults: "No items match your search.",
  request: "Order",
  invoice: "Invoice",
  supplier: "Supplier:",
  unitInline: "Unit:",
  checkDuplicates: "Check duplicates",
  linkExisting: "Link existing",
  approveNew: "Approve new",
  similarPending:
    "Similar new candidates — resolve them before approving a duplicate item:",
  pendingHint:
    "These results are pending candidates, not approved catalog items.",
  specificationDifferent:
    "Specifications differ. Review before marking them as the same item.",
  sameItem: "Same item",
  notSameItem: "Different items",
  reviewCandidateHint:
    "Open the similar candidate and automatically check for duplicates",
  existingMatches:
    "Closest existing catalog items — review before creating a new item:",
  specificationWarning: "Specifications differ — review before linking",
  choosePrimary: "Choose the primary candidate for this item",
  choosePrimaryHint:
    "These candidates represent the same item. Choose which remains the primary candidate for review. This does not create a catalog item or change receipts, stock or costs.",
  oldestSuggested: "Oldest — suggested",
  primaryHint:
    "The primary candidate stays in the review queue. The other is linked to it and removed from the work list. Resolving the primary later will link both to the same catalog item.",
  cancel: "Cancel",
  savingDecision: "Saving decision...",
  linkHeading: "Link candidate to an existing item",
  candidateLabel: "Candidate:",
  smartSuggestions: "Smart suggestions",
  specificationMismatch: "Specifications differ",
  link: "Link",
  manualSearch: "Search the catalog manually",
  manualSearchPlaceholder: "Arabic or English name, or catalog code",
  searching: "Searching...",
  approvalHeading: "Approve a new catalog item",
  approvalHint:
    "Review duplicate suggestions before approval. Creating a catalog item here does not repeat receipt or change quantities or historical costs.",
  strongCandidateWarning:
    "A very similar candidate is pending review. Resolve it first, or correct the item details if this is a different item.",
  strongCatalogWarning:
    "A strong potential catalog match exists. Review it before creating another item.",
  arabicName: "Arabic name *",
  englishName: "English name *",
  englishNamePlaceholder: "Enter the English name manually",
  urduName: "Urdu name",
  unit: "Unit",
  chooseUnit: "Choose a unit",
  manufacturer: "Manufacturer",
  catalogCode: "Catalog code (automatic)",
  chooseFinalLevel: "Choose the final category level",
  generatingCode: "Generating code...",
  chooseFinalFirst: "Choose a final category first",
  codeHint:
    "Generated from the final category code and its current numbering pattern. The server recalculates it on approval.",
  category: "Category *",
  categoryHint:
    "Choose from the catalog category tree. Items can only be added to a final category with no subcategories. The existing category is used without creating a duplicate.",
  categorySearch: "Search the category tree by name or code...",
  arabicDescription: "Arabic description",
  englishDescription: "English description",
  checkingDuplicates: "Checking duplicates...",
  approveAndAdd: "Approve and add to catalog",
  collapseCategory: "Collapse category",
  expandCategory: "Expand category",
  parentCategoryTitle: "Parent category — expand and choose a final level",
  leafCategoryTitle: "Final category available for adding items",
  parentCategoryHint: "Parent category — choose one of its final subcategories",
  selectedCategory: "Selected category:",
  noCategories: "No active categories.",
  noMatchingCategories: "No category matches your search.",
  operationFailed: "Could not complete this action. Please try again.",
  approved: "Item approved and added to the catalog{code}",
  sameItemSaved:
    "Candidates marked as the same item. Candidate #{id} is primary; the other will be resolved with it automatically.",
  similarFound:
    "Found {count} similar new candidates; review them before approval",
  candidateMissing: "Candidate #{id} was not found in the current queue",
  notSameConfirm:
    "Confirm that candidate #{first} and candidate #{second} are different items?\n\nThis decision will be saved and the pair will not be suggested as duplicates again.",
  linkBookConfirm:
    "Link “{candidate}” to catalog item “{catalog}”?\n\nEach stock record and lot retains its quantities, unit and history. Linking does not merge balances or move transactions.",
  pendingDuplicateConfirm:
    "Another candidate is pending review with a {score}% match (#{id}).\n\nReview it first to avoid duplicate items. Stay in the approval form to review the details?",
  catalogDuplicateConfirm:
    "A strong potential match ({score}%) exists with “{name}”.\n\nHave you reviewed it and confirmed this is a different new item?",
  shownCount: "{visible} of {total}",
  reviewCandidate: "Review candidate #{id}",
  linkConfirm:
    "Link “{candidate}” to catalog item “{catalog}”?\n\nThis step does not change quantities, costs or historical receipts.",
};

export function getCatalogCandidatesText(language: string) {
  return language === "en" ? en : ar;
}
