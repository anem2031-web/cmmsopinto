import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronDown, Plus, Edit, Trash2, FolderTree, Loader2, X, ListChecks, Wand2,
} from "lucide-react";
import { nanoid } from "nanoid";

type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual";

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "يومي",
  weekly: "أسبوعي",
  monthly: "شهري",
  quarterly: "ربع سنوي",
  biannual: "نصف سنوي",
  annual: "سنوي",
};

interface BranchNode {
  id: number;
  title: string;
  parentId: number | null;
  isGroupOnly: boolean;
  frequency: Frequency | null;
  frequencyValue: number | null;
  assignedToId: number | null;
  siteId: number | null;
  sectionId: number | null;
  isActive: boolean;
  children: BranchNode[];
}

interface ChecklistFormItem {
  // dbId: موجود لو البند محفوظ فعلاً بقاعدة البيانات (وضع التعديل)، غير موجود = بند جديد لسه ما انحفظ
  clientKey: string;
  dbId?: number;
  text: string;
  isRequired: boolean;
}

interface BranchFormState {
  title: string;
  description: string;
  isGroupOnly: boolean;
  frequency: Frequency | "";
  frequencyValue: number;
  assignedToId: string;
  siteId: string;
  sectionId: string;
  checklist: ChecklistFormItem[];
}

const EMPTY_FORM: BranchFormState = {
  title: "",
  description: "",
  isGroupOnly: false,
  frequency: "",
  frequencyValue: 1,
  assignedToId: "",
  siteId: "",
  sectionId: "",
  checklist: [],
};

export default function BranchTree() {
  const utils = trpc.useUtils();
  const { data: tree = [], isLoading } = trpc.preventive.listTree.useQuery();
  const { data: pmTechnicians = [] } = trpc.users.listTechnicians.useQuery();
  const { data: sites = [] } = trpc.sites.list.useQuery();

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [activeParentId, setActiveParentId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BranchFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<BranchNode | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<{ childrenCount: number; workOrdersCount: number } | null>(null);

  // الأقسام التنظيمية الحقيقية (جدول sections) التابعة للموقع المختار حالياً
  // بفورم إنشاء فرع رئيسي جديد — تُجلب فقط لما يُختار موقع فعلاً.
  const { data: siteSections = [], isLoading: siteSectionsLoading } = trpc.sections.list.useQuery(
    { siteId: form.siteId ? Number(form.siteId) : 0 },
    { enabled: !!form.siteId }
  );

  const createMut = trpc.preventive.createBranch.useMutation({
    onSuccess: () => {
      toast.success("تم إنشاء الفرع");
      utils.preventive.listTree.invalidate();
      setDialogOpen(false);
    },
    onError: (e) => toast.error(e.message || "فشل إنشاء الفرع"),
  });

  const updateMut = trpc.preventive.updateBranch.useMutation({
    onSuccess: () => {
      utils.preventive.listTree.invalidate();
    },
    onError: (e) => toast.error(e.message || "فشل تحديث الفرع"),
  });

  const deleteMut = trpc.preventive.deleteBranch.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الفرع");
      utils.preventive.listTree.invalidate();
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.message || "تعذّر حذف الفرع"),
  });

  const applyTemplateMut = trpc.preventive.applyDefaultSections.useMutation({
    onSuccess: (data) => {
      toast.success(`تم إنشاء ${data.createdCount} قسم، وتخطي ${data.skippedCount} قسم موجود مسبقاً`);
      utils.preventive.listTree.invalidate();
    },
    onError: (e) => toast.error(e.message || "تعذّر إنشاء الأقسام الأساسية"),
  });

  // قائمة الفحص المقترحة بانتظار تأكيد المستخدم (لأن الفورم فيه بنود موجودة أصلاً)
  const [pendingSuggestion, setPendingSuggestion] = useState<string[] | null>(null);

  // يُستدعى عند تغيير حقل "التكرار" بالفورم — يقترح قائمة فحص جاهزة لو عنوان
  // الفرع يطابق أحد الأقسام القياسية (معدات التشغيل، الكهرباء، السباكة...).
  // لو الفورم فاضي من البنود يطبّق مباشرة، ولو فيه بنود موجودة يسأل تأكيد أول.
  const handleFrequencyChange = async (v: string) => {
    const newFreq = v as Frequency;
    setForm(f => ({ ...f, frequency: newFreq }));
    if (!["daily", "weekly", "monthly"].includes(newFreq) || !form.title.trim()) return;
    try {
      const result = await utils.client.preventive.getSuggestedChecklist.query({
        title: form.title.trim(),
        frequency: newFreq as "daily" | "weekly" | "monthly",
      });
      if (result.items.length === 0) return;
      if (form.checklist.length === 0) {
        setForm(f => ({
          ...f,
          checklist: result.items.map(text => ({ clientKey: nanoid(), text, isRequired: true })),
        }));
        toast.success(`تم اقتراح ${result.items.length} بند فحص تلقائياً لـ"${form.title}"`);
      } else {
        setPendingSuggestion(result.items);
      }
    } catch {
      // فشل الاقتراح مو حرج — نتجاهله بصمت ونسيب الفني يكمل يدوياً
    }
  };

  const addChecklistItemMut = trpc.preventive.addChecklistItem.useMutation();
  const updateChecklistItemMut = trpc.preventive.updateChecklistItem.useMutation();
  const deleteChecklistItemMut = trpc.preventive.deleteChecklistItem.useMutation();

  // نسخة "قبل التعديل" من بنود الفحص — نقارن معها عند الحفظ لمعرفة أي بند
  // أضيف/تعدّل/حُذف (وضع التعديل فقط؛ الإنشاء يرسل القائمة كاملة دفعة وحدة).
  const [originalChecklist, setOriginalChecklist] = useState<ChecklistFormItem[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  const blockersQuery = trpc.preventive.getBranchDeletionBlockers.useQuery(
    { id: deleteTarget?.id ?? 0 },
    { enabled: !!deleteTarget }
  );

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCreate = (parentId: number | null) => {
    setDialogMode("create");
    setActiveParentId(parentId);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOriginalChecklist([]);
    setDialogOpen(true);
  };

  const openEdit = async (node: BranchNode) => {
    setDialogMode("edit");
    setEditingId(node.id);
    setActiveParentId(node.parentId);
    setForm({
      title: node.title,
      description: "",
      isGroupOnly: node.isGroupOnly,
      frequency: node.frequency ?? "",
      frequencyValue: node.frequencyValue ?? 1,
      assignedToId: node.assignedToId ? String(node.assignedToId) : "",
      siteId: node.siteId ? String(node.siteId) : "",
      sectionId: node.sectionId ? String(node.sectionId) : "",
      checklist: [],
    });
    setDialogOpen(true);
    setLoadingChecklist(true);
    try {
      const items = await utils.preventive.getChecklistItems.fetch({ planId: node.id });
      const loaded: ChecklistFormItem[] = (items ?? []).map((it: any) => ({
        clientKey: `db-${it.id}`,
        dbId: it.id,
        text: it.text,
        isRequired: it.isRequired ?? true,
      }));
      setForm(f => ({ ...f, checklist: loaded }));
      setOriginalChecklist(loaded);
    } catch (e) {
      toast.error("تعذّر تحميل قائمة الفحص الحالية");
    } finally {
      setLoadingChecklist(false);
    }
  };

  const addChecklistRow = () => {
    setForm(f => ({ ...f, checklist: [...f.checklist, { clientKey: nanoid(), text: "", isRequired: true }] }));
  };

  const updateChecklistRow = (clientKey: string, text: string) => {
    setForm(f => ({ ...f, checklist: f.checklist.map(c => c.clientKey === clientKey ? { ...c, text } : c) }));
  };

  const removeChecklistRow = (clientKey: string) => {
    setForm(f => ({ ...f, checklist: f.checklist.filter(c => c.clientKey !== clientKey) }));
  };

  // يزامن بنود الفحص بوضع التعديل: يحذف المُزال، يعدّل المتغيّر، يضيف الجديد
  const syncChecklistForEdit = async (planId: number) => {
    const currentItems = form.checklist.filter(c => c.text.trim());
    const currentDbIds = new Set(currentItems.filter(c => c.dbId).map(c => c.dbId));

    // حذف: كان موجود بالأصل وما عاد موجود بالقائمة الحالية
    for (const orig of originalChecklist) {
      if (orig.dbId && !currentDbIds.has(orig.dbId)) {
        await deleteChecklistItemMut.mutateAsync({ id: orig.dbId });
      }
    }
    // تعديل: موجود بالأصل والنص تغيّر
    for (const item of currentItems) {
      if (item.dbId) {
        const orig = originalChecklist.find(o => o.dbId === item.dbId);
        if (orig && orig.text !== item.text) {
          await updateChecklistItemMut.mutateAsync({ id: item.dbId, text: item.text });
        }
      }
    }
    // إضافة: بند جديد بدون dbId
    let orderIndex = currentItems.length;
    for (const item of currentItems) {
      if (!item.dbId) {
        await addChecklistItemMut.mutateAsync({ planId, text: item.text, orderIndex: orderIndex++, isRequired: item.isRequired });
      }
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error("العنوان مطلوب");
      return;
    }
    if (!form.isGroupOnly && !form.frequency) {
      toast.error("التكرار مطلوب لأي فرع تنفيذي (غير تجميعي)");
      return;
    }
    const cleanChecklist = form.checklist.filter(c => c.text.trim());
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      isGroupOnly: form.isGroupOnly,
      frequency: form.isGroupOnly ? undefined : (form.frequency as Frequency),
      frequencyValue: form.frequencyValue,
      assignedToId: form.assignedToId ? Number(form.assignedToId) : undefined,
      siteId: form.siteId ? Number(form.siteId) : undefined,
      sectionId: form.sectionId ? Number(form.sectionId) : undefined,
    };
    if (dialogMode === "create") {
      createMut.mutate({
        ...payload,
        parentId: activeParentId ?? undefined,
        checklist: form.isGroupOnly ? [] : cleanChecklist.map(c => ({ id: c.clientKey, text: c.text, required: c.isRequired })),
      });
    } else if (editingId) {
      try {
        await updateMut.mutateAsync({ id: editingId, ...payload });
        if (!form.isGroupOnly) await syncChecklistForEdit(editingId);
        utils.preventive.getChecklistItems.invalidate({ planId: editingId });
        toast.success("تم حفظ التعديلات وقائمة الفحص");
        setDialogOpen(false);
      } catch (e: any) {
        toast.error(e.message || "فشل حفظ قائمة الفحص");
      }
    }
  };

  const confirmDelete = () => {
    if (deleteTarget) deleteMut.mutate({ id: deleteTarget.id });
  };

  const renderNode = (node: BranchNode, depth: number) => {
    const isOpen = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-2 px-2 rounded-md hover:bg-muted/60 group"
          style={{ paddingInlineStart: depth * 24 + 8 }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggle(node.id)}
            className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground"
          >
            {hasChildren ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />) : <span className="w-4" />}
          </button>

          {node.isGroupOnly ? (
            <FolderTree className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          )}

          <span className="font-medium truncate">{node.title}</span>

          {!node.isGroupOnly && node.frequency && (
            <Badge variant="secondary" className="text-xs shrink-0">{FREQUENCY_LABELS[node.frequency]}</Badge>
          )}
          {node.isGroupOnly && (
            <Badge variant="outline" className="text-xs shrink-0">تجميعي</Badge>
          )}
          {!node.isActive && (
            <Badge variant="destructive" className="text-xs shrink-0">معطّل</Badge>
          )}

          <div className="flex-1" />

          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
            {node.parentId === null && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-primary"
                title="إنشاء الأقسام الأساسية (معدات التشغيل، الكهرباء، السباكة...)"
                disabled={applyTemplateMut.isPending}
                onClick={() => applyTemplateMut.mutate({ rootId: node.id })}
              >
                {applyTemplateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" title="إضافة فرع فرعي" onClick={() => openCreate(node.id)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => openEdit(node)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="حذف" onClick={() => setDeleteTarget(node)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {hasChildren && isOpen && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">شجرة الصيانة الدورية</h3>
          <p className="text-sm text-muted-foreground">
            نظّم المواقع والمعدات كفروع متداخلة، وأنشئ أوامر العمل من أي فرع تنفيذي مباشرة.
          </p>
        </div>
        <Button onClick={() => openCreate(null)} className="gap-1">
          <Plus className="h-4 w-4" /> فرع رئيسي جديد
        </Button>
      </div>

      <div className="border rounded-lg p-2 min-h-[120px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> جاري التحميل...
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            لا توجد فروع بعد — ابدأ بإضافة فرع رئيسي (مثال: اسم الموقع أو المشروع).
          </div>
        ) : (
          tree.map((node: any) => renderNode(node, 0))
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create"
                ? (activeParentId ? "إضافة فرع فرعي" : "إضافة فرع رئيسي")
                : "تعديل الفرع"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>عنوان الفرع *</Label>
              {dialogMode === "create" && activeParentId === null && form.isGroupOnly ? (
                <>
                  <Select
                    value={form.siteId}
                    onValueChange={(v) => {
                      // تغيير الموقع يصفّر القسم والعنوان المختارين سابقاً — العنوان
                      // النهائي يتحدد من القسم لا من الموقع نفسه.
                      setForm(f => ({ ...f, siteId: v, sectionId: "", title: "" }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="الخطوة ١ — اختر الموقع من القائمة" /></SelectTrigger>
                    <SelectContent>
                      {sites.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    تُستورد القائمة من المواقع المسجّلة بالنظام. لو الموقع اللي تبيه مو موجود بالقائمة، أضِفه أولاً من إدارة المواقع.
                  </p>

                  {form.siteId && (
                    <div className="border rounded-md p-2.5 bg-muted/40 space-y-1.5">
                      <p className="text-xs font-medium text-foreground">
                        الخطوة ٢ — اختر القسم — هو اللي يصير عنوان الفرع الرئيسي بالشجرة:
                      </p>
                      {siteSectionsLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> جاري التحميل...
                        </div>
                      ) : siteSections.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {siteSections.map((s: any) => {
                            const isSelected = form.sectionId === String(s.id);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setForm(f => ({ ...f, sectionId: String(s.id), title: s.name }))}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                  isSelected
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background border-border hover:bg-muted"
                                }`}
                              >
                                {isSelected && "✓ "}{s.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">لا يوجد أقسام مسجّلة لهذا الموقع بعد — أضفها أولاً من إدارة الأقسام.</p>
                      )}
                    </div>
                  )}

                  {form.title && (
                    <p className="text-xs text-emerald-600">✓ سيُنشأ فرع رئيسي بعنوان: "{form.title}"</p>
                  )}
                </>
              ) : (
                <Input
                  value={form.title}
                  onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="مثال: الكهرباء، اللوحات الكهربائية، لوحة المطبخ..."
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>وصف (اختياري)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="mb-0.5 block">فرع تجميعي فقط</Label>
                <p className="text-xs text-muted-foreground">
                  لا يُنشأ منه أمر عمل ولا يدخل الأتمتة الدورية — للتجميع فقط (مثال: اسم الموقع).
                </p>
              </div>
              <Switch
                checked={form.isGroupOnly}
                onCheckedChange={(v) => setForm(f => ({ ...f, isGroupOnly: v }))}
              />
            </div>

            {!form.isGroupOnly && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>التكرار *</Label>
                    <Select value={form.frequency} onValueChange={handleFrequencyChange}>
                      <SelectTrigger><SelectValue placeholder="اختر التكرار" /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map(freq => (
                          <SelectItem key={freq} value={freq}>{FREQUENCY_LABELS[freq]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>كل كم مرة</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.frequencyValue}
                      onChange={(e) => setForm(f => ({ ...f, frequencyValue: Number(e.target.value) || 1 }))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>الفني المسؤول</Label>
                  <Select value={form.assignedToId} onValueChange={(v) => setForm(f => ({ ...f, assignedToId: v }))}>
                    <SelectTrigger><SelectValue placeholder="اختياري — يُورث من فرع الأب إن لم يُحدَّد" /></SelectTrigger>
                    <SelectContent>
                      {pmTechnicians.map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <ListChecks className="h-3.5 w-3.5" /> قائمة الفحص (Checklist)
                    </Label>
                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={addChecklistRow}>
                      <Plus className="h-3 w-3" /> إضافة بند
                    </Button>
                  </div>

                  {loadingChecklist ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل قائمة الفحص...
                    </div>
                  ) : form.checklist.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      لا توجد بنود فحص بعد — اضغط "إضافة بند" (اختياري، يمكن إضافتها لاحقاً).
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pe-1">
                      {form.checklist.map((item, idx) => (
                        <div key={item.clientKey} className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                          <Input
                            value={item.text}
                            onChange={(e) => updateChecklistRow(item.clientKey, e.target.value)}
                            placeholder="مثال: فحص ضغط المياه العام"
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button" size="icon" variant="ghost"
                            className="h-8 w-8 shrink-0 text-destructive"
                            onClick={() => removeChecklistRow(item.clientKey)}
                            title="حذف البند"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending || addChecklistItemMut.isPending || updateChecklistItemMut.isPending || deleteChecklistItemMut.isPending}>
              {(createMut.isPending || updateMut.isPending || addChecklistItemMut.isPending || updateChecklistItemMut.isPending || deleteChecklistItemMut.isPending) && <Loader2 className="h-4 w-4 animate-spin me-1" />}
              {dialogMode === "create" ? "إنشاء" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف الفرع</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm">
            {blockersQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> جاري التحقق...
              </div>
            ) : blockersQuery.data && (blockersQuery.data.childrenCount > 0 || blockersQuery.data.workOrdersCount > 0) ? (
              <div className="text-destructive space-y-1">
                <p>لا يمكن حذف "{deleteTarget?.title}" حالياً:</p>
                {blockersQuery.data.childrenCount > 0 && <p>• يحتوي على {blockersQuery.data.childrenCount} فرع فرعي — احذفهم أولاً.</p>}
                {blockersQuery.data.workOrdersCount > 0 && <p>• مرتبط بـ {blockersQuery.data.workOrdersCount} أمر عمل.</p>}
              </div>
            ) : (
              <p>هل أنت متأكد من حذف الفرع "{deleteTarget?.title}"؟ لا يمكن التراجع عن هذا الإجراء.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending || blockersQuery.isLoading || !!(blockersQuery.data && (blockersQuery.data.childrenCount > 0 || blockersQuery.data.workOrdersCount > 0))}
              onClick={confirmDelete}
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin me-1" />}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── تأكيد استبدال قائمة الفحص بالمقترحة تلقائياً ── */}
      <Dialog open={!!pendingSuggestion} onOpenChange={(open) => !open && setPendingSuggestion(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>استبدال قائمة الفحص؟</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground space-y-1">
            <p>
              فيه قائمة فحص جاهزة لـ"{form.title}" بتكرار {form.frequency ? FREQUENCY_LABELS[form.frequency as Frequency] : ""}
              {" "}({pendingSuggestion?.length ?? 0} بند).
            </p>
            <p>تطبيقها بيستبدل كل البنود الحالية بالفورم ({form.checklist.length} بند حالياً). تبي تكمل؟</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingSuggestion(null)}>إلغاء، احتفظ بقائمتي</Button>
            <Button
              onClick={() => {
                setForm(f => ({
                  ...f,
                  checklist: (pendingSuggestion ?? []).map(text => ({ clientKey: nanoid(), text, isRequired: true })),
                }));
                setPendingSuggestion(null);
              }}
            >
              استبدال بالقائمة المقترحة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
