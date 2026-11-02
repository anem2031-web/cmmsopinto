import { useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  FolderTree,
  Inbox,
  Link2,
  Loader2,
  PackagePlus,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface ItemCandidate {
  id: number;
  inventoryId: number;
  sourceReceiptId: number;
  sourceReceiptItemId: number;
  purchaseOrderId: number | null;
  purchaseOrderItemId: number | null;
  catalogSupplierId: number | null;
  supplierCandidateId: number | null;
  invoiceNumber: string | null;
  itemName: string;
  itemNameAr: string | null;
  itemNameEn: string | null;
  supplierItemCode: string | null;
  purchaseUnit: string | null;
  manufacturerBarcode: string | null;
  createdAt: string;
  supplierNameAr?: string | null;
  supplierNameEn?: string | null;
  poNumber?: string | null;
}

interface CatalogMatch {
  catalogItemId: number;
  code?: string | null;
  nameAr: string;
  nameEn?: string | null;
  unit?: string | null;
  score: number;
  reason: string;
  measurementStatus: "compatible" | "conflict" | "unknown";
  measurementNote?: string | null;
}

interface PendingCandidateMatch {
  candidateId: number;
  itemName: string;
  itemNameAr?: string | null;
  itemNameEn?: string | null;
  inventoryId?: number | null;
  purchaseOrderId?: number | null;
  invoiceNumber?: string | null;
  catalogSupplierId?: number | null;
  supplierItemCode?: string | null;
  purchaseUnit?: string | null;
  score: number;
  reason: string;
  measurementStatus: "compatible" | "conflict" | "unknown";
  measurementNote?: string | null;
}


interface CatalogNode {
  id: number;
  parentId: number | null;
  nameAr: string;
  nameEn?: string | null;
  code?: string | null;
  level?: number | null;
  sortOrder?: number | null;
}

interface ApprovalForm {
  nameAr: string;
  nameEn: string;
  nameUr: string;
  descriptionAr: string;
  descriptionEn: string;
  nodeId: number | null;
  unit: string;
  manufacturer: string;
}

const EMPTY_FORM: ApprovalForm = {
  nameAr: "",
  nameEn: "",
  nameUr: "",
  descriptionAr: "",
  descriptionEn: "",
  nodeId: null,
  unit: "",
  manufacturer: "",
};

const reasonLabel = (reason: string) => ({
  supplier_code_exact: "SKU معروف لهذا المورد",
  supplier_alias_exact: "اسم معروف لهذا المورد",
  supplier_alias_similar: "اسم قريب من ذاكرة المورد",
  catalog_name_exact: "تطابق اسم الكتالوج",
  catalog_local_strong: "اقتراح بحث ذكي",
  catalog_semantic: "تشابه دلالي",
  ai_semantic: "ترتيب دلالي بمساعدة AI",
}[reason] || "اقتراح كتالوج");

export default function CatalogItemCandidatesManager() {
  const bookUtils = trpc.useUtils();
  const [suggestionsByCandidate, setSuggestionsByCandidate] = useState<Record<number, CatalogMatch[]>>({});
  const [pendingDuplicatesByCandidate, setPendingDuplicatesByCandidate] = useState<Record<number, PendingCandidateMatch[]>>({});
  const [checkingCandidateId, setCheckingCandidateId] = useState<number | null>(null);
  const [highlightedCandidateId, setHighlightedCandidateId] = useState<number | null>(null);
  const [sameItemPair, setSameItemPair] = useState<{ candidate: ItemCandidate; match: PendingCandidateMatch } | null>(null);
  const [linkCandidate, setLinkCandidate] = useState<ItemCandidate | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [approvalCandidate, setApprovalCandidate] = useState<ItemCandidate | null>(null);
  const [form, setForm] = useState<ApprovalForm>(EMPTY_FORM);
  const [nodeSearch, setNodeSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");

  const {
    data: candidates = [],
    isLoading,
    refetch: refetchCandidates,
  } = trpc.catalog.itemCandidates.listPending.useQuery({ limit: 200 });
  const candidateQuery = candidateSearch.trim().toLocaleLowerCase();
  const visibleCandidates = (candidates as ItemCandidate[]).filter(candidate =>
    !candidateQuery || [candidate.itemName, candidate.itemNameAr, candidate.itemNameEn]
      .some(name => name?.toLocaleLowerCase().includes(candidateQuery))
  );

  const { data: nodes = [] } = trpc.catalog.nodes.list.useQuery({ isActive: true });
  const { data: units = [] } = trpc.catalog.units.list.useQuery();

  const manualCatalogQuery = trpc.catalog.items.list.useQuery(
    {
      search: linkSearch.trim() || undefined,
      limit: 30,
      offset: 0,
      isActive: true,
    },
    { enabled: !!linkCandidate },
  );

  const selectedNode = useMemo(
    () => form.nodeId ? (nodes as CatalogNode[]).find(node => node.id === form.nodeId) || null : null,
    [nodes, form.nodeId],
  );
  const selectedNodeHasChildren = useMemo(
    () => !!form.nodeId && (nodes as CatalogNode[]).some(node => node.parentId === form.nodeId),
    [nodes, form.nodeId],
  );

  const codePreviewQuery = trpc.catalog.itemCandidates.previewNextCode.useQuery(
    { nodeId: form.nodeId || 0 },
    {
      enabled: !!approvalCandidate && !!form.nodeId && !selectedNodeHasChildren,
      retry: false,
    },
  );

  const suggestMut = trpc.catalog.itemCandidates.suggestExisting.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const linkMut = trpc.catalog.itemCandidates.linkExisting.useMutation({
    onSuccess: () => {
      refetchCandidates();
      bookUtils.inventory.books.invalidate(); bookUtils.inventory.bookPages.invalidate(); bookUtils.catalog.items.list.invalidate();
      setLinkCandidate(null);
      setLinkSearch("");
      toast.success("تم حسم المرشح وربطه بصنف كتالوج موجود");
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMut = trpc.catalog.itemCandidates.approveNew.useMutation({
    onSuccess: (result) => {
      refetchCandidates();
      setApprovalCandidate(null);
      setForm(EMPTY_FORM);
      setNodeSearch("");
      toast.success(`تم اعتماد الصنف وإضافته إلى الكتالوج${result.catalogItemCode ? ` — ${result.catalogItemCode}` : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const sameItemMut = trpc.catalog.itemCandidates.markSameItem.useMutation({
    onSuccess: (result) => {
      setSameItemPair(null);
      setSuggestionsByCandidate(prev => {
        const next = { ...prev };
        delete next[result.secondaryCandidateId];
        return next;
      });
      setPendingDuplicatesByCandidate(prev => {
        const next = { ...prev };
        delete next[result.secondaryCandidateId];
        delete next[result.primaryCandidateId];
        return next;
      });
      refetchCandidates();
      toast.success(`تم اعتبار المرشحين نفس الصنف. Candidate #${result.primaryCandidateId} هو المرشح الأساسي وسيُحسم الآخر معه تلقائياً.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const notSameItemMut = trpc.catalog.itemCandidates.markNotSameItem.useMutation({
    onSuccess: (_result, variables) => {
      setPendingDuplicatesByCandidate(prev => {
        const next = { ...prev };
        next[variables.candidateId] = (next[variables.candidateId] || []).filter(match => match.candidateId !== variables.otherCandidateId);
        next[variables.otherCandidateId] = (next[variables.otherCandidateId] || []).filter(match => match.candidateId !== variables.candidateId);
        return next;
      });
      toast.success("تم تسجيل أن المرشحين ليسا نفس الصنف، ولن يعاد اقتراح هذا الزوج كتكرار.");
    },
    onError: (e) => toast.error(e.message),
  });

  const checkDuplicates = async (candidate: ItemCandidate) => {
    setCheckingCandidateId(candidate.id);
    try {
      const result = await suggestMut.mutateAsync({ candidateId: candidate.id, limit: 5 });
      const catalogMatches = (result.catalogMatches || []) as CatalogMatch[];
      const candidateMatches = (result.candidateMatches || []) as PendingCandidateMatch[];
      setSuggestionsByCandidate(prev => ({ ...prev, [candidate.id]: catalogMatches }));
      setPendingDuplicatesByCandidate(prev => ({ ...prev, [candidate.id]: candidateMatches }));
      if (!catalogMatches.length && !candidateMatches.length) {
        toast.info("لم يتم العثور على تطابق موثوق في الكتالوج أو بين المرشحين الجدد");
      } else if (candidateMatches.length) {
        toast.warning(`تم العثور على ${candidateMatches.length} مرشح جديد مشابه؛ راجعه قبل الاعتماد`);
      }
      return { catalogMatches, candidateMatches };
    } catch {
      return { catalogMatches: [] as CatalogMatch[], candidateMatches: [] as PendingCandidateMatch[] };
    } finally {
      setCheckingCandidateId(null);
    }
  };

  const openLinkDialog = async (candidate: ItemCandidate) => {
    setLinkCandidate(candidate);
    setLinkSearch(candidate.itemNameAr || candidate.itemName || candidate.itemNameEn || "");
    if (!suggestionsByCandidate[candidate.id]) await checkDuplicates(candidate);
  };

  const openApprovalDialog = async (candidate: ItemCandidate) => {
    setApprovalCandidate(candidate);
    const activeCandidateUnit = (units as any[]).find((unit: any) =>
      unit.nameAr === candidate.purchaseUnit || unit.nameEn === candidate.purchaseUnit
    );
    setForm({
      ...EMPTY_FORM,
      nameAr: candidate.itemNameAr || candidate.itemName || "",
      nameEn: "",
      unit: activeCandidateUnit?.nameAr || "",
    });
    setNodeSearch("");
    if (!suggestionsByCandidate[candidate.id]) await checkDuplicates(candidate);
  };

  const goToPendingCandidate = (candidateId: number) => {
    setApprovalCandidate(null);
    setLinkCandidate(null);

    const targetCandidate = (candidates as ItemCandidate[]).find(candidate => candidate.id === candidateId);
    if (!targetCandidate) {
      toast.error(`تعذر العثور على Candidate #${candidateId} في قائمة الانتظار الحالية`);
      return;
    }

    setCandidateSearch("");
    setHighlightedCandidateId(candidateId);
    window.setTimeout(() => {
      document.getElementById(`catalog-candidate-${candidateId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      void checkDuplicates(targetCandidate);
    }, 100);

    window.setTimeout(() => {
      setHighlightedCandidateId(current => current === candidateId ? null : current);
    }, 3500);
  };

  const markCandidatesNotSame = (candidate: ItemCandidate, match: PendingCandidateMatch) => {
    const ok = window.confirm(
      `تأكيد أن Candidate #${candidate.id} وCandidate #${match.candidateId} ليسا نفس الصنف؟\n\nسيحفظ النظام هذا القرار ولن يعيد اقتراح هذا الزوج كتكرار لاحقاً.`,
    );
    if (!ok) return;
    notSameItemMut.mutate({ candidateId: candidate.id, otherCandidateId: match.candidateId });
  };

  const confirmSameItemPrimary = (primaryCandidateId: number) => {
    if (!sameItemPair) return;
    sameItemMut.mutate({
      candidateId: sameItemPair.candidate.id,
      otherCandidateId: sameItemPair.match.candidateId,
      primaryCandidateId,
    });
  };


  const confirmLink = (catalogItemId: number, catalogName: string) => {
    if (!linkCandidate) return;
    const ok = window.confirm(
      `ربط «${linkCandidate.itemName}» بدفتر صنف الكتالوج «${catalogName}»؟\n\nيبقى كل سجل مخزون ولوت مستقلًا بكمياته ووحدته وتاريخه. لا تُدمج الأرصدة أو تُنقل الحركات عند الربط.`,
    );
    if (!ok) return;
    linkMut.mutate({ candidateId: linkCandidate.id, catalogItemId });
  };

  const handleApproveNew = () => {
    if (!approvalCandidate) return;
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      toast.error("الاسم العربي والإنجليزي مطلوبان");
      return;
    }
    if (!form.nodeId) {
      toast.error("يجب اختيار تصنيف للصنف");
      return;
    }
    if (selectedNodeHasChildren) {
      toast.error("لا يمكن إضافة صنف إلى تصنيف رئيسي. اختر آخر مستوى في شجرة التصنيف");
      return;
    }
    if (!selectedNode?.code?.trim()) {
      toast.error("التصنيف النهائي المختار لا يحتوي على كود؛ لا يمكن توليد كود الصنف");
      return;
    }
    if (codePreviewQuery.isError || !codePreviewQuery.data?.code) {
      toast.error("تعذر توليد كود الكتالوج لهذا التصنيف. راجع التصنيف ثم حاول مرة أخرى");
      return;
    }

    const pendingDuplicates = pendingDuplicatesByCandidate[approvalCandidate.id] || [];
    const strongPendingDuplicate = pendingDuplicates.find(match => match.measurementStatus !== "conflict" && match.score >= 85);
    if (strongPendingDuplicate) {
      const ok = window.confirm(
        `يوجد Candidate آخر بانتظار المراجعة بنسبة ${strongPendingDuplicate.score}% (#${strongPendingDuplicate.candidateId}).\n\nراجع المرشح الآخر أولاً لتجنب إنشاء صنفين مكررين. هل تريد البقاء في نموذج الاعتماد ومراجعة البيانات؟`,
      );
      if (!ok) goToPendingCandidate(strongPendingDuplicate.candidateId);
      return;
    }

    const suggestions = suggestionsByCandidate[approvalCandidate.id] || [];
    const strongDuplicate = suggestions.find(match => match.measurementStatus !== "conflict" && match.score >= 85);
    if (strongDuplicate) {
      const ok = window.confirm(
        `يوجد تطابق محتمل قوي (${strongDuplicate.score}%) مع «${strongDuplicate.nameAr}».\n\nهل راجعت الاقتراح وتؤكد أن المرشح صنف جديد مختلف فعلاً؟`,
      );
      if (!ok) return;
    }

    approveMut.mutate({
      candidateId: approvalCandidate.id,
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim(),
      nameUr: form.nameUr.trim() || undefined,
      descriptionAr: form.descriptionAr.trim() || undefined,
      descriptionEn: form.descriptionEn.trim() || undefined,
      nodeId: form.nodeId,
      unit: form.unit.trim() || undefined,
      manufacturer: form.manufacturer.trim() || undefined,
    });
  };

  if (isLoading) {
    return <div className="py-16 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري تحميل المرشحين...</div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Inbox className="w-5 h-5 text-amber-600" />
            إدخال الأصناف الجديدة إلى الكتالوج
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            أصناف استُلمت تشغيليًا كـ«صنف جديد» وتنتظر حسم Master Data. المراجعة هنا لا تعيد الاستلام ولا تغيّر الكميات أو التكلفة.
          </p>
        </div>
        <Badge variant="outline" className="self-start sm:self-auto">{candidateQuery ? `${visibleCandidates.length} من ${candidates.length}` : candidates.length} بانتظار المراجعة</Badge>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input type="search" aria-label="البحث في الأصناف الجديدة" value={candidateSearch}
          onChange={event => setCandidateSearch(event.target.value)}
          placeholder="ابحث باسم الصنف بالعربية أو الإنجليزية…" className="pr-9" />
      </div>

      {visibleCandidates.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
            {candidates.length === 0 ? "لا توجد أصناف جديدة بانتظار المراجعة." : "لا توجد أصناف مطابقة للبحث."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleCandidates.map(candidate => {
            const suggestions = suggestionsByCandidate[candidate.id] || [];
            const pendingDuplicates = pendingDuplicatesByCandidate[candidate.id] || [];
            return (
              <Card
                id={`catalog-candidate-${candidate.id}`}
                key={candidate.id}
                className={`border-amber-200/80 scroll-mt-24 transition-all duration-300 ${
                  highlightedCandidateId === candidate.id ? "ring-2 ring-amber-400 bg-amber-50/40 shadow-md" : ""
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-base">{candidate.itemNameAr || candidate.itemName}</p>
                        <Badge variant="secondary">Candidate #{candidate.id}</Badge>
                      </div>
                      {candidate.itemNameEn && candidate.itemNameEn !== candidate.itemNameAr && (
                        <p className="text-sm text-muted-foreground mt-1">{candidate.itemNameEn}</p>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        <span>Inventory #{candidate.inventoryId}</span>
                        <span>Receipt #{candidate.sourceReceiptId}</span>
                        {candidate.poNumber && <span>طلب {candidate.poNumber}</span>}
                        {candidate.invoiceNumber && <span>فاتورة {candidate.invoiceNumber}</span>}
                        {candidate.supplierNameAr && <span>المورد: {candidate.supplierNameAr}</span>}
                        {candidate.supplierItemCode && <span>SKU: {candidate.supplierItemCode}</span>}
                        {candidate.purchaseUnit && <span>الوحدة: {candidate.purchaseUnit}</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={checkingCandidateId === candidate.id}
                        onClick={() => checkDuplicates(candidate)}
                        className="gap-1"
                      >
                        {checkingCandidateId === candidate.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        فحص التكرار
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openLinkDialog(candidate)} className="gap-1">
                        <Link2 className="w-3.5 h-3.5" /> ربط بموجود
                      </Button>
                      <Button size="sm" onClick={() => openApprovalDialog(candidate)} className="gap-1">
                        <PackagePlus className="w-3.5 h-3.5" /> اعتماد جديد
                      </Button>
                    </div>
                  </div>

                  {pendingDuplicates.length > 0 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50/70 p-3">
                      <p className="text-xs font-semibold mb-1 flex items-center gap-1 text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5" /> مرشحون جدد مشابهون — احسم أحدهم قبل اعتماد صنف جديد مكرر:
                      </p>
                      <p className="text-xs text-amber-800 mb-2">هذه النتائج من Queue نفسها وليست أصناف كتالوج معتمدة بعد.</p>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {pendingDuplicates.map(match => (
                          <div key={match.candidateId} className="rounded-md border border-amber-200 bg-background p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm truncate">{match.itemNameAr || match.itemName}</span>
                              <Badge variant={match.measurementStatus === "conflict" ? "destructive" : "outline"}>{match.score}%</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Candidate #{match.candidateId}{match.inventoryId ? ` · Inventory #${match.inventoryId}` : ""}</p>
                            <p className="text-xs text-muted-foreground mt-1">{reasonLabel(match.reason)}</p>
                            {match.measurementStatus === "conflict" && (
                              <p className="text-xs text-red-600 mt-1">{match.measurementNote || "يوجد اختلاف مواصفة؛ راجع قبل اعتبارهما نفس الصنف"}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setSameItemPair({ candidate, match })}
                              >
                                نفس الصنف
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={notSameItemMut.isPending}
                                onClick={() => markCandidatesNotSame(candidate, match)}
                              >
                                ليسا نفس الصنف
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                title="ينقلك إلى المرشح المشابه ويشغل فحص التكرار له تلقائياً"
                                onClick={() => goToPendingCandidate(match.candidateId)}
                              >
                                راجع Candidate #{match.candidateId}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {suggestions.length > 0 && (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <p className="text-xs font-medium mb-2">أقرب أصناف موجودة في الكتالوج — راجعها قبل إنشاء صنف جديد:</p>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {suggestions.slice(0, 5).map(match => (
                          <button
                            type="button"
                            key={match.catalogItemId}
                            onClick={() => { setLinkCandidate(candidate); confirmLinkWithCandidate(candidate, match.catalogItemId, match.nameAr, linkMut); }}
                            className="text-right rounded-md border bg-background p-2.5 hover:border-primary/50 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm truncate">{match.nameAr}</span>
                              <Badge variant={match.measurementStatus === "conflict" ? "destructive" : "outline"}>{match.score}%</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{reasonLabel(match.reason)}{match.code ? ` · ${match.code}` : ""}</p>
                            {match.measurementStatus === "conflict" && (
                              <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> اختلاف مواصفة — لا تربط قبل المراجعة</p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!sameItemPair}
        onOpenChange={(open) => {
          if (!open && !sameItemMut.isPending) setSameItemPair(null);
        }}
      >
        <DialogContent className="max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>اختيار المرشح الأساسي لنفس الصنف</DialogTitle>
          </DialogHeader>
          {sameItemPair && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                تم تحديد أن المرشحين يمثلان نفس الصنف. اختر أي Candidate يبقى كمرشح أساسي للمراجعة. هذا القرار لا ينشئ Catalog Item ولا يغير الاستلام أو المخزون أو التكلفة.
              </div>

              <div className="grid gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sameItemMut.isPending}
                  onClick={() => confirmSameItemPrimary(sameItemPair.candidate.id)}
                  className="h-auto w-full justify-between gap-3 px-4 py-3 text-right"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">Candidate #{sameItemPair.candidate.id}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground mt-1">
                      {sameItemPair.candidate.itemNameAr || sameItemPair.candidate.itemName}
                    </span>
                  </span>
                  {sameItemPair.candidate.id < sameItemPair.match.candidateId && (
                    <Badge variant="secondary" className="shrink-0">الأقدم — مقترح</Badge>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={sameItemMut.isPending}
                  onClick={() => confirmSameItemPrimary(sameItemPair.match.candidateId)}
                  className="h-auto w-full justify-between gap-3 px-4 py-3 text-right"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">Candidate #{sameItemPair.match.candidateId}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground mt-1">
                      {sameItemPair.match.itemNameAr || sameItemPair.match.itemName}
                    </span>
                  </span>
                  {sameItemPair.match.candidateId < sameItemPair.candidate.id && (
                    <Badge variant="secondary" className="shrink-0">الأقدم — مقترح</Badge>
                  )}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                بعد الاختيار سيبقى الـPrimary في Queue، ويختفي المرشح الآخر من قائمة العمل باعتباره تابعاً له. عند حسم الـPrimary لاحقاً سيُحسم التابع بنفس Catalog Item.
              </p>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={sameItemMut.isPending} onClick={() => setSameItemPair(null)}>
                  إلغاء
                </Button>
                {sameItemMut.isPending && (
                  <span className="inline-flex items-center text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin ml-1" /> جاري حفظ القرار...
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkCandidate} onOpenChange={(open) => !open && setLinkCandidate(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ربط المرشح بصنف موجود</DialogTitle>
          </DialogHeader>
          {linkCandidate && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-3 text-sm">
                المرشح: <strong>{linkCandidate.itemNameAr || linkCandidate.itemName}</strong>
              </div>

              {(suggestionsByCandidate[linkCandidate.id] || []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">الاقتراحات الذكية</p>
                  {(suggestionsByCandidate[linkCandidate.id] || []).map(match => (
                    <div key={match.catalogItemId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{match.nameAr}</p>
                        <p className="text-xs text-muted-foreground">{match.nameEn || ""}{match.code ? ` · ${match.code}` : ""} · {match.score}% · {reasonLabel(match.reason)}</p>
                        {match.measurementStatus === "conflict" && <p className="text-xs text-red-600 mt-1">{match.measurementNote || "يوجد اختلاف في المواصفات"}</p>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => confirmLink(match.catalogItemId, match.nameAr)}>ربط</Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">بحث يدوي في الكتالوج</p>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="الاسم العربي أو الإنجليزي أو كود الكتالوج" className="pr-9" />
                </div>
                {manualCatalogQuery.isFetching ? (
                  <p className="text-sm text-muted-foreground py-4"><Loader2 className="inline w-4 h-4 animate-spin ml-1" /> جاري البحث...</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {(manualCatalogQuery.data || []).map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{item.nameAr}</p>
                          <p className="text-xs text-muted-foreground">{item.nameEn}{item.code ? ` · ${item.code}` : ""}{item.unit ? ` · ${item.unit}` : ""}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => confirmLink(item.id, item.nameAr)}>ربط</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!approvalCandidate} onOpenChange={(open) => !open && setApprovalCandidate(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>اعتماد صنف جديد في الكتالوج</DialogTitle>
          </DialogHeader>
          {approvalCandidate && (
            <div className="space-y-4">
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm">
                قبل الاعتماد راجع اقتراحات التكرار. إنشاء Catalog Item هنا لا يعيد الاستلام ولا يغير الكميات أو التكلفة التاريخية.
              </div>

              {(pendingDuplicatesByCandidate[approvalCandidate.id] || []).some(match => match.score >= 85 && match.measurementStatus !== "conflict") && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
                  يوجد Candidate آخر قوي الشبه بانتظار المراجعة. احسمه أولاً أو صحح بيانات Master إذا كان هذا صنفاً مختلفاً فعلاً.
                </div>
              )}

              {(suggestionsByCandidate[approvalCandidate.id] || []).some(match => match.score >= 85 && match.measurementStatus !== "conflict") && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                  يوجد تطابق محتمل قوي في الكتالوج. راجعه قبل إنشاء نسخة جديدة.
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <Field label="الاسم العربي *"><Input value={form.nameAr} onChange={e => setForm(prev => ({ ...prev, nameAr: e.target.value }))} /></Field>
                <Field label="الاسم الإنجليزي *"><Input value={form.nameEn} onChange={e => setForm(prev => ({ ...prev, nameEn: e.target.value }))} dir="ltr" placeholder="اكتب الاسم الإنجليزي يدويًا" /></Field>
                <Field label="الاسم الأردي"><Input value={form.nameUr} onChange={e => setForm(prev => ({ ...prev, nameUr: e.target.value }))} /></Field>
                <Field label="الوحدة">
                  <select
                    value={form.unit}
                    onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">اختر الوحدة</option>
                    {(units as any[]).map((unit: any) => (
                      <option key={unit.id} value={unit.nameAr}>
                        {unit.nameAr}{unit.nameEn ? ` / ${unit.nameEn}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="المصنع"><Input value={form.manufacturer} onChange={e => setForm(prev => ({ ...prev, manufacturer: e.target.value }))} /></Field>
                <Field label="كود الكتالوج (تلقائي)">
                  <Input
                    value={form.nodeId && !selectedNodeHasChildren ? (codePreviewQuery.data?.code || "") : ""}
                    readOnly
                    placeholder={form.nodeId ? (selectedNodeHasChildren ? "اختر آخر مستوى في التصنيف" : "جاري توليد الكود...") : "اختر التصنيف النهائي أولاً"}
                    dir="ltr"
                  />
                  <p className="text-xs text-muted-foreground">
                    يولده النظام من كود التصنيف النهائي وآخر نمط ترقيم مستخدم داخله، ويعاد حسابه في Backend لحظة الاعتماد.
                  </p>
                  {codePreviewQuery.isError && form.nodeId && !selectedNodeHasChildren && (
                    <p className="text-xs text-red-600">{codePreviewQuery.error.message}</p>
                  )}
                </Field>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <FolderTree className="w-4 h-4 text-blue-600" />
                  التصنيف *
                </label>
                <p className="text-xs text-muted-foreground">
                  اختر من نفس شجرة تصنيفات الكتالوج المستخدمة في تبويب «التصنيفات». يمكن إضافة الصنف فقط إلى آخر مستوى (تصنيف بلا تفرعات)، وسيتم حفظ نفس nodeId بدون إنشاء تصنيف موازٍ.
                </p>
                <Input placeholder="ابحث داخل شجرة التصنيفات بالاسم أو الكود..." value={nodeSearch} onChange={e => setNodeSearch(e.target.value)} />
                <CatalogNodeTreeSelector
                  nodes={(nodes as CatalogNode[])}
                  search={nodeSearch}
                  selectedNodeId={form.nodeId}
                  onSelect={(nodeId) => setForm(prev => ({ ...prev, nodeId }))}
                />
              </div>

              <Field label="الوصف العربي">
                <textarea className="w-full min-h-20 rounded-md border bg-background px-3 py-2 text-sm" value={form.descriptionAr} onChange={e => setForm(prev => ({ ...prev, descriptionAr: e.target.value }))} />
              </Field>
              <Field label="الوصف الإنجليزي">
                <textarea dir="ltr" className="w-full min-h-20 rounded-md border bg-background px-3 py-2 text-sm" value={form.descriptionEn} onChange={e => setForm(prev => ({ ...prev, descriptionEn: e.target.value }))} />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setApprovalCandidate(null)}>إلغاء</Button>
                <Button disabled={approveMut.isPending || checkingCandidateId === approvalCandidate.id || (!!form.nodeId && !selectedNodeHasChildren && codePreviewQuery.isLoading)} onClick={handleApproveNew} className="gap-1">
                  {(approveMut.isPending || checkingCandidateId === approvalCandidate.id) && <Loader2 className="w-4 h-4 animate-spin" />}
                  {checkingCandidateId === approvalCandidate.id ? "جاري فحص التكرار..." : "اعتماد وإضافة للكتالوج"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


function CatalogNodeTreeSelector({
  nodes,
  search,
  selectedNodeId,
  onSelect,
}: {
  nodes: CatalogNode[];
  search: string;
  selectedNodeId: number | null;
  onSelect: (nodeId: number) => void;
}) {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<number>>(() => new Set());

  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);

  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, CatalogNode[]>();
    for (const node of nodes) {
      const parentId = node.parentId && nodeById.has(node.parentId) ? node.parentId : null;
      const list = map.get(parentId) || [];
      list.push(node);
      map.set(parentId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (sortDiff) return sortDiff;
        const codeDiff = String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true });
        if (codeDiff) return codeDiff;
        return a.nameAr.localeCompare(b.nameAr, "ar");
      });
    }
    return map;
  }, [nodes, nodeById]);

  const normalizedSearch = search.trim().toLowerCase();

  const visibleNodeIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const visible = new Set<number>();
    for (const node of nodes) {
      const haystack = `${node.nameAr || ""} ${node.nameEn || ""} ${node.code || ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) continue;
      let current: CatalogNode | undefined = node;
      const visited = new Set<number>();
      while (current && !visited.has(current.id)) {
        visible.add(current.id);
        visited.add(current.id);
        current = current.parentId ? nodeById.get(current.parentId) : undefined;
      }
    }
    return visible;
  }, [nodes, nodeById, normalizedSearch]);

  const selectedPath = useMemo(() => {
    if (!selectedNodeId) return [] as CatalogNode[];
    const path: CatalogNode[] = [];
    let current = nodeById.get(selectedNodeId);
    const visited = new Set<number>();
    while (current && !visited.has(current.id)) {
      path.push(current);
      visited.add(current.id);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
    return path.reverse();
  }, [nodeById, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) return;
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      let current = nodeById.get(selectedNodeId);
      const visited = new Set<number>();
      while (current?.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        next.add(current.parentId);
        current = nodeById.get(current.parentId);
      }
      return next;
    });
  }, [nodeById, selectedNodeId]);

  const toggleExpanded = (nodeId: number) => {
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderNode = (node: CatalogNode, depth: number): ReactNode => {
    if (visibleNodeIds && !visibleNodeIds.has(node.id)) return null;
    const children = childrenByParent.get(node.id) || [];
    const hasChildren = children.length > 0;
    const expanded = !!normalizedSearch || expandedNodeIds.has(node.id);
    const selected = selectedNodeId === node.id;

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1 rounded-md border px-2 py-1.5 mb-1 transition-colors ${
            selected ? "border-blue-500 bg-blue-50 text-blue-900" : "border-transparent hover:border-slate-200 hover:bg-slate-50"
          }`}
          style={{ marginRight: `${depth * 18}px` }}
        >
          <button
            type="button"
            className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded hover:bg-slate-100 disabled:opacity-30"
            disabled={!hasChildren}
            onClick={() => hasChildren && toggleExpanded(node.id)}
            aria-label={expanded ? "طي التصنيف" : "فتح التصنيف"}
          >
            {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />) : <span className="w-4" />}
          </button>
          <button
            type="button"
            onClick={() => hasChildren ? toggleExpanded(node.id) : onSelect(node.id)}
            className={`min-w-0 flex-1 text-right flex items-center justify-between gap-2 ${hasChildren ? "text-muted-foreground" : ""}`}
            title={hasChildren ? "تصنيف رئيسي — افتح التفرعات واختر آخر مستوى" : "تصنيف نهائي صالح لإضافة صنف"}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{node.code ? `${node.code} · ` : ""}{node.nameAr}</span>
              {node.nameEn && <span className="block text-xs text-muted-foreground truncate" dir="ltr">{node.nameEn}</span>}
              {hasChildren && <span className="block text-[11px] text-amber-700">تصنيف رئيسي — اختر أحد التفرعات النهائية تحته</span>}
            </span>
            {selected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
          </button>
        </div>
        {hasChildren && expanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const roots = childrenByParent.get(null) || [];

  return (
    <div className="rounded-md border bg-background p-2">
      {selectedPath.length > 0 && (
        <div className="mb-2 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-2 text-xs text-blue-900">
          <span className="font-semibold">التصنيف المختار:</span>{" "}
          {selectedPath.map(node => node.nameAr).join(" ← ")}
        </div>
      )}
      <div className="max-h-72 overflow-y-auto pl-1">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-5 text-center">لا توجد تصنيفات نشطة.</p>
        ) : visibleNodeIds && visibleNodeIds.size === 0 ? (
          <p className="text-sm text-muted-foreground py-5 text-center">لا يوجد تصنيف مطابق للبحث.</p>
        ) : (
          roots.map(node => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function confirmLinkWithCandidate(
  candidate: ItemCandidate,
  catalogItemId: number,
  catalogName: string,
  linkMut: { mutate: (input: { candidateId: number; catalogItemId: number }) => void },
) {
  const ok = window.confirm(
    `ربط «${candidate.itemName}» بصنف الكتالوج «${catalogName}»؟\n\nلن تتغير الكميات أو التكلفة أو الاستلام التاريخي في هذه الخطوة.`,
  );
  if (!ok) return;
  linkMut.mutate({ candidateId: candidate.id, catalogItemId });
}
