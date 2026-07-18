import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Trash2, Edit, ClipboardList, Loader2, Play,
  ChevronLeft, Home, Calendar, Clock, CheckSquare, X, Building2,
} from "lucide-react";

type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual";

const FREQ_LABEL_AR: Record<Frequency, string> = {
  daily: "يومي", weekly: "أسبوعي", monthly: "شهري",
  quarterly: "ربع سنوي", biannual: "نصف سنوي", annual: "سنوي",
};
// نفس صيغة العنوان المُولَّد بالخادم (buildSubPlanTitles) — تُستخدم هنا فقط لمعاينة حيّة قبل الحفظ
const FREQ_ADJ_AR: Record<Frequency, string> = {
  daily: "اليومية", weekly: "الأسبوعية", monthly: "الشهرية",
  quarterly: "ربع السنوية", biannual: "نصف السنوية", annual: "السنوية",
};

const emptySubPlanForm = {
  sectionBranchId: "",
  frequency: "monthly" as Frequency,
  frequencyValue: "1",
  assignedToId: "",
  description: "",
  estimatedDurationMinutes: "",
  nextDueDate: "",
};

export default function PMPlansPanel() {
  const { language } = useLanguage();
  const { getField } = useTranslatedField();
  const utils = trpc.useUtils();

  // ============================================================
  // البطاقات الرئيسية (خارج الشجرة تماماً — لا تتأثر ولا تؤثر عليها)
  // ============================================================
  const [selectedMainPlanId, setSelectedMainPlanId] = useState<number | null>(null);

  const { data: mainPlans = [], isLoading: mainPlansLoading } = trpc.pmPlans.listMainPlans.useQuery();
  const { data: availableBranches = [] } = trpc.pmPlans.listOperationalBranchesWithoutMainPlan.useQuery();

  const selectedMainPlan = (mainPlans as any[]).find((m) => m.id === selectedMainPlanId) ?? null;

  const [showAddMainPlan, setShowAddMainPlan] = useState(false);
  const [newMainPlanSiteId, setNewMainPlanSiteId] = useState("");
  const [newMainPlanBranchId, setNewMainPlanBranchId] = useState("");
  const [deleteMainPlanId, setDeleteMainPlanId] = useState<number | null>(null);

  const createMainPlanMut = trpc.pmPlans.createMainPlan.useMutation({
    onSuccess: () => {
      toast.success("تم إنشاء البطاقة الرئيسية");
      utils.pmPlans.listMainPlans.invalidate();
      utils.pmPlans.listOperationalBranchesWithoutMainPlan.invalidate();
      setShowAddMainPlan(false);
      setNewMainPlanSiteId("");
      setNewMainPlanBranchId("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMainPlanMut = trpc.pmPlans.deleteMainPlan.useMutation({
    onSuccess: () => {
      toast.success("تم حذف البطاقة الرئيسية");
      utils.pmPlans.listMainPlans.invalidate();
      utils.pmPlans.listOperationalBranchesWithoutMainPlan.invalidate();
      setDeleteMainPlanId(null);
    },
    onError: (e: any) => { toast.error(e.message); setDeleteMainPlanId(null); },
  });

  // مواقع فريدة مشتقة من الفروع التشغيلية المتاحة (اللي ما عندها بطاقة رئيسية بعد)
  const sitesForNewMainPlan = useMemo(() => {
    const map = new Map<number, any>();
    for (const b of availableBranches as any[]) {
      if (b.siteId != null && !map.has(b.siteId)) {
        map.set(b.siteId, { id: b.siteId, name: b.siteName, nameEn: b.siteNameEn, nameUr: b.siteNameUr });
      }
    }
    return Array.from(map.values());
  }, [availableBranches]);

  const branchesForSelectedSite = useMemo(
    () => (availableBranches as any[]).filter((b) => String(b.siteId) === newMainPlanSiteId),
    [availableBranches, newMainPlanSiteId]
  );

  const localizedSiteName = (r: any) => (language === "en" && r.nameEn) ? r.nameEn : (language === "ur" && r.nameUr) ? r.nameUr : r.name;
  const localizedBranchTitle = (r: any) => getField({ title: r.title ?? r.branchTitle, title_ar: r.title_ar ?? r.branchTitle_ar, title_en: r.title_en ?? r.branchTitle_en, title_ur: r.title_ur ?? r.branchTitle_ur }, "title");

  // ============================================================
  // الخطط الفرعية (تحت بطاقة رئيسية محددة)
  // ============================================================
  const { data: subPlans = [], isLoading: subPlansLoading } = trpc.pmPlans.listSubPlans.useQuery(
    { mainPlanId: selectedMainPlanId! },
    { enabled: !!selectedMainPlanId }
  );
  const { data: sectionOptions = [] } = trpc.pmPlans.listSectionOptionsForMainPlan.useQuery(
    { mainPlanId: selectedMainPlanId! },
    { enabled: !!selectedMainPlanId }
  );
  const { data: technicians = [] } = trpc.users.listTechnicians.useQuery();

  const [showSubPlanForm, setShowSubPlanForm] = useState(false);
  const [editSubPlanId, setEditSubPlanId] = useState<number | null>(null);
  const [subPlanForm, setSubPlanForm] = useState(emptySubPlanForm);
  const [subPlanChecklist, setSubPlanChecklist] = useState<{ text: string; isRequired: boolean }[]>([]);
  const [newChecklistText, setNewChecklistText] = useState("");
  const [deleteSubPlanId, setDeleteSubPlanId] = useState<number | null>(null);

  const { data: editSubPlanDetail } = trpc.pmPlans.getSubPlanDetail.useQuery(
    { id: editSubPlanId! },
    { enabled: !!editSubPlanId }
  );

  useEffect(() => {
    if (editSubPlanId && editSubPlanDetail) {
      setSubPlanForm({
        sectionBranchId: String((editSubPlanDetail as any).sectionBranchId),
        frequency: (editSubPlanDetail as any).frequency,
        frequencyValue: String((editSubPlanDetail as any).frequencyValue ?? 1),
        assignedToId: (editSubPlanDetail as any).assignedToId ? String((editSubPlanDetail as any).assignedToId) : "",
        description: (editSubPlanDetail as any).description ?? "",
        estimatedDurationMinutes: (editSubPlanDetail as any).estimatedDurationMinutes ? String((editSubPlanDetail as any).estimatedDurationMinutes) : "",
        nextDueDate: (editSubPlanDetail as any).nextDueDate ? new Date((editSubPlanDetail as any).nextDueDate).toISOString().split("T")[0] : "",
      });
      setSubPlanChecklist(((editSubPlanDetail as any).checklist ?? []).map((c: any) => ({
        text: getField(c, "text") || c.text,
        isRequired: c.isRequired ?? true,
      })));
    }
  }, [editSubPlanId, editSubPlanDetail]);

  const selectedSection = (sectionOptions as any[]).find((s) => String(s.id) === subPlanForm.sectionBranchId);
  const titlePreview = selectedSection
    ? `الصيانة الوقائية ${FREQ_ADJ_AR[subPlanForm.frequency]} - ${getField(selectedSection, "title") || selectedSection.title}`
    : "";

  const createSubPlanMut = trpc.pmPlans.createSubPlan.useMutation({
    onSuccess: () => {
      toast.success("تم إنشاء الخطة الفرعية");
      utils.pmPlans.listSubPlans.invalidate({ mainPlanId: selectedMainPlanId! });
      utils.pmPlans.listMainPlans.invalidate();
      closeSubPlanForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateSubPlanMut = trpc.pmPlans.updateSubPlan.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث الخطة الفرعية");
      utils.pmPlans.listSubPlans.invalidate({ mainPlanId: selectedMainPlanId! });
      closeSubPlanForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSubPlanMut = trpc.pmPlans.deleteSubPlan.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الخطة الفرعية");
      utils.pmPlans.listSubPlans.invalidate({ mainPlanId: selectedMainPlanId! });
      utils.pmPlans.listMainPlans.invalidate();
      setDeleteSubPlanId(null);
    },
    onError: (e: any) => { toast.error(e.message); setDeleteSubPlanId(null); },
  });

  const createWorkOrderMut = trpc.pmPlans.createWorkOrderFromSubPlan.useMutation({
    onSuccess: () => toast.success("تم إنشاء أمر العمل"),
    onError: (e: any) => toast.error(e.message),
  });

  function closeSubPlanForm() {
    setShowSubPlanForm(false);
    setEditSubPlanId(null);
    setSubPlanForm(emptySubPlanForm);
    setSubPlanChecklist([]);
    setNewChecklistText("");
  }

  function handleSubPlanSubmit() {
    if (!subPlanForm.sectionBranchId) { toast.error("اختر قسم الصيانة المسؤول"); return; }
    const payload = {
      frequency: subPlanForm.frequency,
      frequencyValue: subPlanForm.frequencyValue ? Number(subPlanForm.frequencyValue) : 1,
      assignedToId: subPlanForm.assignedToId ? Number(subPlanForm.assignedToId) : undefined,
      description: subPlanForm.description || undefined,
      estimatedDurationMinutes: subPlanForm.estimatedDurationMinutes ? Number(subPlanForm.estimatedDurationMinutes) : undefined,
      nextDueDate: subPlanForm.nextDueDate || undefined,
      checklist: subPlanChecklist,
    };
    if (editSubPlanId) {
      updateSubPlanMut.mutate({ id: editSubPlanId, ...payload });
    } else {
      createSubPlanMut.mutate({
        mainPlanId: selectedMainPlanId!,
        sectionBranchId: Number(subPlanForm.sectionBranchId),
        ...payload,
      });
    }
  }

  function openEditSubPlan(id: number) {
    setEditSubPlanId(id);
    setShowSubPlanForm(true);
  }

  function addChecklistItem() {
    if (!newChecklistText.trim()) return;
    setSubPlanChecklist((c) => [...c, { text: newChecklistText.trim(), isRequired: true }]);
    setNewChecklistText("");
  }

  // ============================================================
  // العرض: مستوى البطاقات الرئيسية أو مستوى الخطط الفرعية
  // ============================================================
  if (selectedMainPlanId && selectedMainPlan) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-sm">
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setSelectedMainPlanId(null)}>
            <Home className="h-3.5 w-3.5" /> الرئيسية
          </Button>
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium px-2">
            {localizedSiteName({ name: selectedMainPlan.siteName, nameEn: selectedMainPlan.siteNameEn, nameUr: selectedMainPlan.siteNameUr })}
            {" / "}
            {localizedBranchTitle(selectedMainPlan)}
          </span>
        </div>

        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" onClick={() => { setSubPlanForm(emptySubPlanForm); setSubPlanChecklist([]); setShowSubPlanForm(true); }}>
            <Plus className="h-4 w-4" /> إضافة خطة فرعية
          </Button>
        </div>

        {subPlansLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-40 bg-muted/30" /></Card>)}
          </div>
        ) : (subPlans as any[]).length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد خطط فرعية بعد لهذا القسم</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(subPlans as any[]).map((sp) => {
              const isOverdue = sp.nextDueDate && new Date(sp.nextDueDate) < new Date() && sp.isActive !== false;
              const assigneeName = (technicians as any[]).find((u) => u.id === sp.assignedToId)?.name;
              return (
                <Card key={sp.id} className={isOverdue ? "border-red-200" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{getField(sp, "title") || sp.title}</CardTitle>
                      <Badge variant="outline">{FREQ_LABEL_AR[sp.frequency as Frequency] ?? sp.frequency}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {sp.nextDueDate && (
                      <div className={`flex items-center gap-1 text-xs ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        <Calendar className="h-3 w-3" /> موعد التنفيذ القادم: {new Date(sp.nextDueDate).toLocaleDateString()}
                      </div>
                    )}
                    {sp.estimatedDurationMinutes && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" /> {sp.estimatedDurationMinutes} دقيقة
                      </div>
                    )}
                    {assigneeName && <div className="text-xs text-muted-foreground">👤 {assigneeName}</div>}
                    <div className="flex gap-2 pt-2 flex-wrap">
                      <Button size="sm" className="flex-1" onClick={() => createWorkOrderMut.mutate({ subPlanId: sp.id })} disabled={createWorkOrderMut.isPending}>
                        {createWorkOrderMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 ml-1" />}
                        إنشاء أمر عمل
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditSubPlan(sp.id)}><Edit className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteSubPlanId(sp.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* نافذة إضافة/تعديل خطة فرعية */}
        <Dialog open={showSubPlanForm} onOpenChange={(o) => !o && closeSubPlanForm()}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editSubPlanId ? "تعديل خطة فرعية" : "إضافة خطة فرعية"}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>قسم الصيانة المسؤول *</Label>
                <Select value={subPlanForm.sectionBranchId || "none"} onValueChange={(v) => setSubPlanForm((f) => ({ ...f, sectionBranchId: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">اختر</SelectItem>
                    {(sectionOptions as any[]).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{getField(s, "title") || s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>التكرار *</Label>
                  <Select value={subPlanForm.frequency} onValueChange={(v) => setSubPlanForm((f) => ({ ...f, frequency: v as Frequency }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FREQ_LABEL_AR) as Frequency[]).map((f) => (
                        <SelectItem key={f} value={f}>{FREQ_LABEL_AR[f]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>المسؤول عن التنفيذ</Label>
                  <Select value={subPlanForm.assignedToId || "none"} onValueChange={(v) => setSubPlanForm((f) => ({ ...f, assignedToId: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون</SelectItem>
                      {(technicians as any[]).map((tch) => <SelectItem key={tch.id} value={String(tch.id)}>{tch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>تاريخ بدء التنفيذ</Label>
                  <Input
                    type="date"
                    value={subPlanForm.nextDueDate}
                    onChange={(e) => setSubPlanForm((f) => ({ ...f, nextDueDate: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">إن تُرك فارغاً يُحسب تلقائياً من اليوم حسب التكرار</p>
                </div>
                <div>
                  <Label>مدة التنفيذ المتوقعة (دقيقة)</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="مثال: 60"
                    value={subPlanForm.estimatedDurationMinutes}
                    onChange={(e) => setSubPlanForm((f) => ({ ...f, estimatedDurationMinutes: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label>عنوان الخطة (تلقائي)</Label>
                <Input value={titlePreview} disabled readOnly placeholder="يُبنى تلقائياً من التكرار + قسم الصيانة" />
              </div>
              <div>
                <Label>الوصف (اختياري)</Label>
                <Textarea value={subPlanForm.description} onChange={(e) => setSubPlanForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
              </div>
              <div>
                <Label>قائمة التحقق</Label>
                <div className="space-y-1.5 mb-2">
                  {subPlanChecklist.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1">
                      <span className="flex-1 text-sm">{item.text}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSubPlanChecklist((c) => c.filter((_, i) => i !== idx))}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="بند فحص جديد (مثال: فحص القواطع)"
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                  />
                  <Button type="button" variant="outline" onClick={addChecklistItem}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeSubPlanForm}>إلغاء</Button>
              <Button
                onClick={handleSubPlanSubmit}
                disabled={!subPlanForm.sectionBranchId || createSubPlanMut.isPending || updateSubPlanMut.isPending}
              >
                {(createSubPlanMut.isPending || updateSubPlanMut.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* تأكيد حذف خطة فرعية */}
        <Dialog open={!!deleteSubPlanId} onOpenChange={(o) => !o && setDeleteSubPlanId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>تأكيد الحذف</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">هل أنت متأكد من حذف هذه الخطة الفرعية؟ لا يمكن التراجع.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteSubPlanId(null)}>إلغاء</Button>
              <Button variant="destructive" onClick={() => deleteSubPlanMut.mutate({ id: deleteSubPlanId! })} disabled={deleteSubPlanMut.isPending}>
                {deleteSubPlanMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حذف"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── مستوى البطاقات الرئيسية ──
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setShowAddMainPlan(true)}>
          <Plus className="h-4 w-4" /> إضافة خطة صيانة رئيسية
        </Button>
      </div>

      {mainPlansLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-32 bg-muted/30" /></Card>)}
        </div>
      ) : (mainPlans as any[]).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>لا توجد بطاقات رئيسية بعد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(mainPlans as any[]).map((mp) => (
            <Card key={mp.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{localizedBranchTitle(mp)}</CardTitle>
                <p className="text-xs text-muted-foreground">{localizedSiteName({ name: mp.siteName, nameEn: mp.siteNameEn, nameUr: mp.siteNameUr })}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-xs text-muted-foreground">{mp.subPlansCount} خطة فرعية</div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => setSelectedMainPlanId(mp.id)}>
                    عرض الخطط الفرعية <ChevronLeft className="h-3 w-3 mr-1" />
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteMainPlanId(mp.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* نافذة إضافة بطاقة رئيسية: موقع ← قسم تشغيلي */}
      <Dialog open={showAddMainPlan} onOpenChange={(o) => { if (!o) { setShowAddMainPlan(false); setNewMainPlanSiteId(""); setNewMainPlanBranchId(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة خطة صيانة رئيسية</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>الموقع *</Label>
              <Select value={newMainPlanSiteId || "none"} onValueChange={(v) => { setNewMainPlanSiteId(v === "none" ? "" : v); setNewMainPlanBranchId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">اختر</SelectItem>
                  {sitesForNewMainPlan.map((s) => <SelectItem key={s.id} value={String(s.id)}>{localizedSiteName(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>القسم التشغيلي *</Label>
              {!newMainPlanSiteId ? (
                <p className="text-xs text-muted-foreground mt-2">اختر الموقع أولاً</p>
              ) : branchesForSelectedSite.length === 0 ? (
                <p className="text-xs text-amber-600 mt-2">لا يوجد قسم تشغيلي بهذا الموقع بدون بطاقة رئيسية — أنشئه أولاً من تبويب الشجرة</p>
              ) : (
                <Select value={newMainPlanBranchId || "none"} onValueChange={(v) => setNewMainPlanBranchId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">اختر</SelectItem>
                    {branchesForSelectedSite.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>{getField(b, "title") || b.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMainPlan(false)}>إلغاء</Button>
            <Button
              onClick={() => createMainPlanMut.mutate({ branchId: Number(newMainPlanBranchId) })}
              disabled={!newMainPlanBranchId || createMainPlanMut.isPending}
            >
              {createMainPlanMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد حذف بطاقة رئيسية */}
      <Dialog open={!!deleteMainPlanId} onOpenChange={(o) => !o && setDeleteMainPlanId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تأكيد الحذف</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">هل أنت متأكد من حذف هذه البطاقة الرئيسية؟ يجب حذف كل الخطط الفرعية التابعة لها أولاً.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteMainPlanId(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={() => deleteMainPlanMut.mutate({ id: deleteMainPlanId! })} disabled={deleteMainPlanMut.isPending}>
              {deleteMainPlanMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
