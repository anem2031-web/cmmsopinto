import { useState, useMemo, useEffect } from "react";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import PMPlansPanel from "@/components/preventive/PMPlansPanel";
import {
  Plus, Calendar, Clock, CheckSquare, AlertTriangle,
  Play, Trash2, Edit, ClipboardList, Camera, Loader2, Eye,
  Search, Filter, X, Power, PowerOff, FileText,
  ChevronLeft, ChevronRight, FolderTree, Home,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslatedField, getLocalizedName } from "@/hooks/useTranslatedField";
import PMExecution from "@/pages/preventive/PMExecution";
import BranchTree from "@/components/preventive/BranchTree";

type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual";
type WOStatus = "scheduled" | "in_progress" | "completed" | "overdue" | "cancelled";

interface ChecklistItem {
  id: string;
  text: string;
  required?: boolean;
}

interface ChecklistResult {
  id: string;
  text: string;
  done: boolean;
  notes?: string;
}

interface PlanForm {
  title: string;
  description: string;
  assetId: string;
  siteId: string;
  frequency: Frequency;
  frequencyValue: string;
  estimatedDurationMinutes: string;
  assignedToId: string;
  checklist: ChecklistItem[];
  nextDueDate: string;
}

const defaultPlanForm: PlanForm = {
  title: "", description: "", assetId: "", siteId: "",
  frequency: "monthly", frequencyValue: "1",
  estimatedDurationMinutes: "", assignedToId: "",
  checklist: [], nextDueDate: "",
};

const woStatusConfig: Record<WOStatus, { color: string }> = {
  scheduled: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  in_progress: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  completed: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  overdue: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  cancelled: { color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
};

export default function PreventiveMaintenance() {
  const { t, language } = useLanguage();
  const { getField } = useTranslatedField();
  const [tab, setTab] = useState("plans");
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editPlanId, setEditPlanId] = useState<number | null>(null);
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);
  const [previewPlanId, setPreviewPlanId] = useState<number | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(defaultPlanForm);
  const [planRootId, setPlanRootId] = useState(""); // القسم (عنوان الشجرة/الفرع الجذر) — قد يوجد أكثر من قسم واحد تحت نفس الموقع
  const [planSectionId, setPlanSectionId] = useState(""); // قسم الصيانة المسؤول — تفرّع تحت "القسم" الذي ستُنشأ الخطة الجديدة تحته
  const [deletePlanId, setDeletePlanId] = useState<number | null>(null);
  const [deleteWOId, setDeleteWOId] = useState<number | null>(null);
  const [generateWOPlanId, setGenerateWOPlanId] = useState<number | null>(null);
  const [generateDate, setGenerateDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set());
  const [selectedWO, setSelectedWO] = useState<any | null>(null);
  const [newChecklistText, setNewChecklistText] = useState("");

  // ── فلاتر الخطط ──
  const [planSearch, setPlanSearch] = useState("");
  const [planFilterAsset, setPlanFilterAsset] = useState("all");
  const [planFilterSite, setPlanFilterSite] = useState("all");
  const [planFilterFreq, setPlanFilterFreq] = useState("all");

  // ── فلاتر أوامر العمل ──
  const [woFilterStatus, setWoFilterStatus] = useState("all");
  const [woFilterAssignee, setWoFilterAssignee] = useState("all");
  const [woDateFrom, setWoDateFrom] = useState("");
  const [woDateTo, setWoDateTo] = useState("");

  // ── رفع صورة إتمام العمل ──
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState("");
  const [executionWOId, setExecutionWOId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: plans = [], isLoading: plansLoading } = trpc.preventive.listPlans.useQuery({});
  const { data: previewChecklistItems = [] } = trpc.preventive.getChecklistItems.useQuery(
    { planId: previewPlanId! },
    { enabled: !!previewPlanId }
  );
  const { data: workOrders = [], isLoading: woLoading } = trpc.preventive.listWorkOrders.useQuery({});
  const { data: assets = [] } = trpc.assets.list.useQuery({});
  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: branchTree = [] } = trpc.preventive.listTree.useQuery();
  const { data: editBranchPath = [] } = trpc.preventive.getBranchPath.useQuery(
    { id: editPlanId! },
    { enabled: !!editPlanId }
  );
  // Phase 4: use listTechnicians as primary source for PM assignee dropdown and display.
  // users.list is still available if other parts of the page need it, but PM assignment
  // should now resolve names through the technician-specific query.
  const { data: users = [] } = trpc.users.list.useQuery();
  const { data: pmTechnicians = [] } = trpc.users.listTechnicians.useQuery();

  // كل الأقسام (فروع جذرية) المرتبطة بالموقع المختار — قد يكون فيه أكثر من قسم تحت نفس الموقع.
  // الخطة الجديدة تُنشأ كفرع حقيقي تحت "قسم الصيانة المسؤول" المختار (نفس شجرة preventive_plans)،
  // وتظهر تلقائياً في تبويب الشجرة وفي التصفّح التدريجي بتبويب الخطط عبر "عرض الفروع".
  const rootOptionsForSite = useMemo(
    () => (branchTree as any[]).filter((r: any) => r.siteId != null && String(r.siteId) === planForm.siteId),
    [branchTree, planForm.siteId]
  );
  const selectedRootBranch = useMemo(
    () => rootOptionsForSite.find((r: any) => String(r.id) === planRootId),
    [rootOptionsForSite, planRootId]
  );
  const sectionOptions: any[] = selectedRootBranch?.children ?? [];

  // عند فتح نافذة التعديل، نشتق الموقع (جذر المسار) والقسم (الجذر نفسه) وقسم الصيانة المسؤول (الأب المباشر) من مسار الفرع الحالي
  useEffect(() => {
    if (editPlanId && editBranchPath.length > 0) {
      const root = editBranchPath[0] as any;
      const parent = editBranchPath.length >= 2 ? (editBranchPath[editBranchPath.length - 2] as any) : null;
      setPlanForm(f => ({ ...f, siteId: root?.siteId ? String(root.siteId) : f.siteId }));
      setPlanRootId(root ? String(root.id) : "");
      setPlanSectionId(parent ? String(parent.id) : "");
    }
  }, [editPlanId, editBranchPath]);

  const createBranchMut = trpc.preventive.createBranch.useMutation({
    onSuccess: () => {
      toast.success(t.preventive.planCreated);
      utils.preventive.listPlans.invalidate();
      utils.preventive.listTree.invalidate();
      setShowPlanForm(false);
      setPlanForm(defaultPlanForm);
      setPlanRootId("");
      setPlanSectionId("");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateBranchMut = trpc.preventive.updateBranch.useMutation({
    onSuccess: () => {
      toast.success(t.preventive.planUpdated);
      utils.preventive.listPlans.invalidate();
      utils.preventive.listTree.invalidate();
      setShowPlanForm(false);
      setEditPlanId(null);
      setPlanForm(defaultPlanForm);
      setPlanRootId("");
      setPlanSectionId("");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActiveMut = trpc.preventive.updatePlan.useMutation({
    onSuccess: () => {
      toast.success(t.preventive.planUpdated);
      utils.preventive.listPlans.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePlanMut = trpc.preventive.deletePlan.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.preventive.listPlans.invalidate();
      setDeletePlanId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteWOMut = trpc.preventive.deleteWorkOrder.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.preventive.listWorkOrders.invalidate();
      setDeleteWOId(null);
    },
    onError: (e) => { toast.error(e.message); setDeleteWOId(null); },
  });

  // ─── الحل الهجين لإنشاء أمر العمل ───
  const candidatesQuery = trpc.preventive.previewWorkOrderCandidates.useQuery(
    { planId: generateWOPlanId ?? 0 },
    { enabled: !!generateWOPlanId }
  );

  const createHybridWOMut = trpc.preventive.createHybridWorkOrder.useMutation({
    onSuccess: () => {
      toast.success(t.preventive.workOrderCreated);
      utils.preventive.listWorkOrders.invalidate();
      utils.preventive.listPlans.invalidate();
      setGenerateWOPlanId(null);
      setTab("workOrders");
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (candidatesQuery.data?.candidates) {
      setSelectedCandidateIds(new Set(candidatesQuery.data.candidates.map((c: any) => c.id)));
    }
  }, [candidatesQuery.data]);

  // ── معاينة الفني + قائمة التحقق قبل التأكيد الفعلي ──
  // لو ما فيه اختيار (فرع وحيد بلا أبناء)، نعرض كل المرشحين. لو فيه اختيار،
  // نعرض بس الفروع المُحدَّدة حاليًا (تتحدث لحظياً مع كل تغيير بالتحديد).
  const previewCandidates = candidatesQuery.data
    ? (candidatesQuery.data.needsSelection
        ? candidatesQuery.data.candidates.filter((c: any) => selectedCandidateIds.has(c.id))
        : candidatesQuery.data.candidates)
    : [];
  const previewPlanIds = previewCandidates.map((c: any) => c.id);
  const previewItemsQuery = trpc.preventive.previewChecklistItems.useQuery(
    { planIds: previewPlanIds },
    { enabled: previewPlanIds.length > 0 }
  );

  const toggleCandidate = (id: number) => {
    setSelectedCandidateIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateWorkOrder = () => {
    if (!generateWOPlanId) return;
    const ids = Array.from(selectedCandidateIds);
    if (ids.length === 0) {
      toast.error("اختر فرعاً واحداً على الأقل");
      return;
    }
    createHybridWOMut.mutate({ planIds: ids, scheduledDate: generateDate });
  };


  const updateWOMut = trpc.preventive.updateWorkOrder.useMutation({
    onSuccess: () => {
      toast.success(t.preventive.workOrderUpdated);
      utils.preventive.listWorkOrders.invalidate();
      setSelectedWO(null);
      setCompletionPhotoUrl("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handlePlanSubmit = () => {
    if (!computedPlanTitle) {
      toast.error(t.preventive.selectSectionRequired);
      return;
    }
    const payload = {
      title: computedPlanTitle,
      description: planForm.description || undefined,
      assetId: planForm.assetId ? Number(planForm.assetId) : undefined,
      frequency: planForm.frequency,
      frequencyValue: planForm.frequencyValue ? Number(planForm.frequencyValue) : 1,
      estimatedDurationMinutes: planForm.estimatedDurationMinutes ? Number(planForm.estimatedDurationMinutes) : undefined,
      assignedToId: planForm.assignedToId ? Number(planForm.assignedToId) : undefined,
      checklist: planForm.checklist,
      nextDueDate: planForm.nextDueDate || undefined,
    };
    if (editPlanId) {
      updateBranchMut.mutate({ id: editPlanId, ...payload, parentId: planSectionId ? Number(planSectionId) : undefined });
    } else {
      if (!planSectionId) {
        toast.error(t.preventive.selectSectionRequired);
        return;
      }
      createBranchMut.mutate({ ...payload, parentId: Number(planSectionId), isGroupOnly: false });
    }
  };

  const handlePlanSiteChange = (v: string) => {
    setPlanForm(f => ({ ...f, siteId: v === "none" ? "" : v }));
    setPlanRootId(""); // إعادة تعيين القسم عند تغيير الموقع لأن خيارات القسم تختلف حسب الموقع
    setPlanSectionId("");
  };

  const handlePlanRootChange = (v: string) => {
    setPlanRootId(v === "none" ? "" : v);
    setPlanSectionId(""); // إعادة تعيين قسم الصيانة المسؤول لأن خياراته تختلف حسب القسم المختار
  };

  const openEditPlan = (plan: any) => {
    setEditPlanId(plan.id);
    setPlanForm({
      title: plan.title ?? "",
      description: plan.description ?? "",
      assetId: plan.assetId ? String(plan.assetId) : "",
      siteId: plan.siteId ? String(plan.siteId) : "",
      frequency: plan.frequency ?? "monthly",
      frequencyValue: plan.frequencyValue ? String(plan.frequencyValue) : "1",
      estimatedDurationMinutes: plan.estimatedDurationMinutes ? String(plan.estimatedDurationMinutes) : "",
      assignedToId: plan.assignedToId ? String(plan.assignedToId) : "",
      checklist: plan.checklist ?? [],
      nextDueDate: plan.nextDueDate ? new Date(plan.nextDueDate).toISOString().split("T")[0] : "",
    });
    // الموقع والقسم وقسم الصيانة المسؤول يُشتقّون تلقائياً من مسار الفرع الفعلي عبر useEffect أعلاه (editBranchPath)
    setShowPlanForm(true);
  };

  const addChecklistItem = () => {
    if (!newChecklistText.trim()) return;
    setPlanForm(f => ({
      ...f,
      checklist: [...f.checklist, { id: nanoid(), text: newChecklistText.trim() }],
    }));
    setNewChecklistText("");
  };

  const removeChecklistItem = (id: string) => {
    setPlanForm(f => ({ ...f, checklist: f.checklist.filter(c => c.id !== id) }));
  };

  // رفع صورة إتمام العمل
  const handleUploadCompletionPhoto = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploadingPhoto(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.url) {
          setCompletionPhotoUrl(data.url);
          setSelectedWO((w: any) => ({ ...w, completionPhotoUrl: data.url }));
          toast.success("تم رفع الصورة بنجاح");
        }
      } catch {
        toast.error("فشل رفع الصورة");
      }
      setUploadingPhoto(false);
    };
    input.click();
  };

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      total: plans.length,
      overdue: plans.filter((p: any) => p.nextDueDate && new Date(p.nextDueDate) < now && p.isActive !== false).length,
      upcoming: plans.filter((p: any) => {
        if (!p.nextDueDate || p.isActive === false) return false;
        const d = new Date(p.nextDueDate);
        return d >= now && d <= weekFromNow;
      }).length,
      pendingWO: workOrders.filter((w: any) => w.status === "scheduled" || w.status === "in_progress").length,
    };
  }, [plans, workOrders]);

  const freqLabel = (f: Frequency | null | undefined) => {
    if (!f) return "—";
    const map: Record<Frequency, string> = {
      daily: t.preventive.daily,
      weekly: t.preventive.weekly,
      monthly: t.preventive.monthly,
      quarterly: t.preventive.quarterly,
      biannual: t.preventive.biannual,
      annual: t.preventive.annual,
    };
    return map[f] ?? f;
  };

  // قسم الصيانة المسؤول المختار حالياً (لبناء العنوان الديناميكي)
  const selectedSectionBranch = useMemo(
    () => sectionOptions.find((s: any) => String(s.id) === planSectionId),
    [sectionOptions, planSectionId]
  );

  // العنوان الديناميكي: القسم-قسم الصيانة المسؤول-التكرار (مثال: البقالة-السباكة-شهري)
  const computedPlanTitle = useMemo(() => {
    if (selectedRootBranch && selectedSectionBranch) {
      const parts: string[] = [
        getField(selectedRootBranch, "title") || selectedRootBranch.title,
        getField(selectedSectionBranch, "title") || selectedSectionBranch.title,
        freqLabel(planForm.frequency),
      ];
      return parts.join("-");
    }
    // لا تحديد كامل بعد (أو تعديل خطة قديمة بدون إعادة اختيار القسم) — نعرض العنوان المخزّن الحالي إن وجد
    return planForm.title || "";
  }, [selectedRootBranch, selectedSectionBranch, planForm.frequency, planForm.title, language]);

  const woStatusLabel = (s: WOStatus) => {
    const map: Record<WOStatus, string> = {
      scheduled: t.preventive.scheduled,
      in_progress: t.preventive.in_progress,
      completed: t.preventive.completed,
      overdue: t.preventive.overdue,
      cancelled: t.preventive.cancelled,
    };
    return map[s] ?? s;
  };

  // ── مطابقة الفلاتر لفرع تنفيذي واحد (مستقل عن موقعه بالشجرة) ──
  const matchesPlanFilters = (p: any) => {
    if (planSearch && !p.title?.toLowerCase().includes(planSearch.toLowerCase()) && !p.planNumber?.includes(planSearch)) return false;
    if (planFilterAsset !== "all" && String(p.assetId) !== planFilterAsset) return false;
    if (planFilterSite !== "all" && String(p.siteId) !== planFilterSite) return false;
    if (planFilterFreq !== "all" && p.frequency !== planFilterFreq) return false;
    return true;
  };

  // ── الخطط المفلترة (تنفيذية فقط — تُستخدم للعدّ الإجمالي أعلى الصفحة) ──
  const filteredPlans = useMemo(() => {
    return plans.filter((p: any) => !p.isGroupOnly && matchesPlanFilters(p));
  }, [plans, planSearch, planFilterAsset, planFilterSite, planFilterFreq]);

  // ── بناء الشجرة الهرمية الكاملة لعرضها كأقسام متداخلة داخل "خطط الصيانة" ──
  const childrenByParent = useMemo(() => {
    const map = new Map<number | "root", any[]>();
    for (const p of plans) {
      const key = p.parentId ?? "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [plans]);

  const plansById = useMemo(() => {
    const map = new Map<number, any>();
    for (const p of plans) map.set(p.id, p);
    return map;
  }, [plans]);

  // عدد الفروع التنفيذية المطابقة للفلاتر (هذا الفرع + كل أحفاده) — لشارة العدّاد بعنوان كل قسم
  const countMatchingDescendants = (node: any): number => {
    let n = !node.isGroupOnly && matchesPlanFilters(node) ? 1 : 0;
    const children = childrenByParent.get(node.id) ?? [];
    for (const c of children) n += countMatchingDescendants(c);
    return n;
  };

  // ── التصفّح التدريجي (Drill-down): null = المستوى الجذر ──
  const [browseParentId, setBrowseParentId] = useState<number | null>(null);

  const browsePath = useMemo(() => {
    const path: any[] = [];
    let cursor = browseParentId ? plansById.get(browseParentId) : null;
    let depth = 0;
    while (cursor && depth < 20) {
      path.unshift(cursor);
      cursor = cursor.parentId ? plansById.get(cursor.parentId) : null;
      depth++;
    }
    return path;
  }, [browseParentId, plansById]);

  const currentLevelNodes = childrenByParent.get(browseParentId ?? "root") ?? [];

  const visibleLevelNodes = useMemo(() => {
    return currentLevelNodes.filter((node: any) => {
      if (node.isGroupOnly) {
        // الفروع التجميعية تُفلتر بالبحث فقط (ما فيها أصل/موقع/تكرار أصلاً)
        if (planSearch && !node.title?.toLowerCase().includes(planSearch.toLowerCase())) return false;
        return true;
      }
      return matchesPlanFilters(node);
    });
  }, [currentLevelNodes, planSearch, planFilterAsset, planFilterSite, planFilterFreq]);

  // ── أوامر العمل المفلترة ──
  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((w: any) => {
      if (woFilterStatus !== "all" && w.status !== woFilterStatus) return false;
      if (woFilterAssignee !== "all" && String(w.assignedToId) !== woFilterAssignee) return false;
      if (woDateFrom && w.scheduledDate && new Date(w.scheduledDate) < new Date(woDateFrom)) return false;
      if (woDateTo && w.scheduledDate && new Date(w.scheduledDate) > new Date(woDateTo + "T23:59:59")) return false;
      return true;
    });
  }, [workOrders, woFilterStatus, woFilterAssignee, woDateFrom, woDateTo]);

  const hasActivePlanFilters = planSearch || planFilterAsset !== "all" || planFilterSite !== "all" || planFilterFreq !== "all";
  const hasActiveWOFilters = woFilterStatus !== "all" || woFilterAssignee !== "all" || woDateFrom || woDateTo;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.preventive.title}</h1>
          <p className="text-muted-foreground text-sm">{t.preventive.description}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-blue-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">{t.preventive.plans}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats.overdue}</p>
              <p className="text-xs text-muted-foreground">{t.preventive.overduePlans}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="h-8 w-8 text-orange-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats.upcoming}</p>
              <p className="text-xs text-muted-foreground">{t.preventive.upcomingThisWeek}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Play className="h-8 w-8 text-yellow-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats.pendingWO}</p>
              <p className="text-xs text-muted-foreground">{t.preventive.workOrders}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tree">الشجرة</TabsTrigger>
          <TabsTrigger value="plans">{t.preventive.plans} ({plans.length})</TabsTrigger>
          <TabsTrigger value="workOrders">{t.preventive.workOrders} ({workOrders.length})</TabsTrigger>
        </TabsList>

        {/* ── Branch Tree Tab (جديد) ── */}
        <TabsContent value="tree" className="mt-4">
          <BranchTree />
        </TabsContent>

        {/* ── Plans Tab ── */}
        <TabsContent value="plans" className="mt-4">
          <PMPlansPanel />
        </TabsContent>

        <TabsContent value="workOrders" className="mt-4 space-y-4">
          {/* فلاتر أوامر العمل */}
          <Card className="border-dashed">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Select value={woFilterStatus} onValueChange={setWoFilterStatus}>
                  <SelectTrigger><SelectValue placeholder={t.common.status || "الحالة"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.allStatuses || "جميع الحالات"}</SelectItem>
                    {(["scheduled","in_progress","completed","overdue","cancelled"] as WOStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{woStatusLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={woFilterAssignee} onValueChange={setWoFilterAssignee}>
                  <SelectTrigger><SelectValue placeholder={t.common.technician || "الفني"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.allTechnicians || "جميع الفنيين"}</SelectItem>
                    {/* Phase 4: use pmTechnicians (users.listTechnicians) for PM assignment dropdown */}
                  {(pmTechnicians.length > 0 ? pmTechnicians : users).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div>
                  <Input type="date" value={woDateFrom} onChange={e => setWoDateFrom(e.target.value)} placeholder="من تاريخ" />
                </div>
                <div>
                  <Input type="date" value={woDateTo} onChange={e => setWoDateTo(e.target.value)} placeholder="إلى تاريخ" />
                </div>
              </div>
              {hasActiveWOFilters && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">{t.common.results || "النتائج"}: {filteredWorkOrders.length} {t.common.of || "من"} {workOrders.length}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => { setWoFilterStatus("all"); setWoFilterAssignee("all"); setWoDateFrom(""); setWoDateTo(""); }}>
                    <X className="h-3 w-3" /> {t.common.clearFilters || "مسح الفلاتر"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {woLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-20 bg-muted/30" /></Card>)}
            </div>
          ) : filteredWorkOrders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{hasActiveWOFilters ? "لا توجد نتائج للفلاتر المحددة" : t.preventive.noWorkOrders}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredWorkOrders.map((wo: any) => {
                const cfg = woStatusConfig[wo.status as WOStatus] ?? woStatusConfig.scheduled;
                // Phase 4: resolve assignee name from pmTechnicians (users.listTechnicians) first
                const assigneeName = (pmTechnicians.find((u: any) => u.id === wo.assignedToId) as any)?.name
                  ?? users.find((u: any) => u.id === wo.assignedToId)?.name;
                const doneCount = (wo.checklistResults as ChecklistResult[] | null)?.filter(c => c.done).length ?? 0;
                const totalCount = (wo.checklistResults as ChecklistResult[] | null)?.length ?? 0;
                return (
                  <Card key={wo.id} className="hover:shadow-sm transition-shadow cursor-pointer" onClick={() => { setSelectedWO(wo); setCompletionPhotoUrl(wo.completionPhotoUrl ?? ""); }}>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-muted-foreground">{wo.workOrderNumber}</p>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                            {woStatusLabel(wo.status)}
                          </span>
                        </div>
                        <p className="font-medium truncate">{getField(wo, "title")}</p>
                        <div className="flex items-center gap-3 mt-1">
                          {wo.scheduledDate && (
                            <p className="text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3 inline ml-1" />
                              {new Date(wo.scheduledDate).toLocaleDateString()}
                            </p>
                          )}
                          {assigneeName && (
                            <p className="text-xs text-muted-foreground">👤 {assigneeName}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {(wo.status === "scheduled" || wo.status === "in_progress") && (
                          <Button
                            size="sm"
                            variant="default"
                            className="text-xs h-7 px-2"
                            onClick={(e) => { e.stopPropagation(); setExecutionWOId(wo.id); }}
                          >
                            <Play className="h-3 w-3 ml-1" />
                            {wo.status === "in_progress" ? (t.preventive?.continue || "متابعة") : (t.preventive?.startInspection || "ابدأ الفحص")}
                          </Button>
                        )}
                        {wo.status === "scheduled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2 text-destructive hover:text-destructive"
                            title="حذف أمر العمل (متاح فقط قبل بدء الفحص)"
                            onClick={(e) => { e.stopPropagation(); setDeleteWOId(wo.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        {totalCount > 0 && (
                          <div className="text-xs text-muted-foreground text-center">
                            <CheckSquare className="h-4 w-4 inline mb-0.5" />
                            <br />
                            {doneCount}/{totalCount}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── PM Execution Dialog ── */}
      <Dialog open={executionWOId !== null} onOpenChange={(o) => { if (!o) setExecutionWOId(null); }}>
        <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto p-0" dir="rtl">
          {executionWOId !== null && (
            <PMExecution workOrderId={executionWOId} onClose={() => setExecutionWOId(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Plan Form Dialog ── */}
      <Dialog open={showPlanForm} onOpenChange={(o) => { if (!o) { setShowPlanForm(false); setEditPlanId(null); setPlanForm(defaultPlanForm); setPlanRootId(""); setPlanSectionId(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editPlanId ? t.preventive.editPlan : t.preventive.addPlan}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>{t.preventive.planTitle} *</Label>
              <Input value={computedPlanTitle} disabled readOnly placeholder={t.preventive.autoTitleHint} />
              <p className="text-xs text-muted-foreground mt-1">{t.preventive.autoTitleHint}</p>
            </div>
            <div>
              <Label>{t.preventive.frequency}</Label>
              <Select value={planForm.frequency} onValueChange={v => setPlanForm(f => ({ ...f, frequency: v as Frequency }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["daily","weekly","monthly","quarterly","biannual","annual"] as Frequency[]).map(f => (
                    <SelectItem key={f} value={f}>{freqLabel(f)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.preventive.estimatedDuration}</Label>
              <Input type="number" value={planForm.estimatedDurationMinutes} onChange={e => setPlanForm(f => ({ ...f, estimatedDurationMinutes: e.target.value }))} />
            </div>
            <div>
              <Label>{t.assets.location} *</Label>
              <Select value={planForm.siteId || "none"} onValueChange={handlePlanSiteChange}>
                <SelectTrigger><SelectValue placeholder={t.common.none} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.common.none}</SelectItem>
                  {sites.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{getLocalizedName(s, language)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.preventive.section} *</Label>
              {!planForm.siteId ? (
                <p className="text-xs text-muted-foreground mt-2">{t.preventive.selectSiteFirst}</p>
              ) : rootOptionsForSite.length === 0 ? (
                <p className="text-xs text-amber-600 mt-2">{t.preventive.noBranchForSite}</p>
              ) : (
                <Select value={planRootId || "none"} onValueChange={handlePlanRootChange}>
                  <SelectTrigger><SelectValue placeholder={t.common.none} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.common.none}</SelectItem>
                    {rootOptionsForSite.map((r: any) => (
                      <SelectItem key={r.id} value={String(r.id)}>{getField(r, "title") || r.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>{t.preventive.responsibleSection} *</Label>
              {!planRootId ? (
                <p className="text-xs text-muted-foreground mt-2">{t.preventive.selectSectionFirst}</p>
              ) : sectionOptions.length === 0 ? (
                <p className="text-xs text-amber-600 mt-2">{t.preventive.noSubBranchForSection}</p>
              ) : (
                <Select value={planSectionId || "none"} onValueChange={v => setPlanSectionId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t.common.none} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.common.none}</SelectItem>
                    {sectionOptions.map((sec: any) => (
                      <SelectItem key={sec.id} value={String(sec.id)}>{getField(sec, "title") || sec.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>{t.preventive.assignedTo}</Label>
              <Select value={planForm.assignedToId || "none"} onValueChange={v => setPlanForm(f => ({ ...f, assignedToId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder={t.common.none} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.common.none}</SelectItem>
                  {/* Phase 4: use pmTechnicians (users.listTechnicians) for PM assignment dropdown */}
                  {(pmTechnicians.length > 0 ? pmTechnicians : users).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.preventive.nextDueDate}</Label>
              <Input type="date" value={planForm.nextDueDate} onChange={e => setPlanForm(f => ({ ...f, nextDueDate: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>{t.common.description}</Label>
              <Textarea value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            {/* Checklist */}
            <div className="col-span-2">
              <Label>{t.preventive.checklist}</Label>
              <div className="space-y-2 mt-1">
                {planForm.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 bg-muted/30 rounded px-3 py-1.5">
                    <CheckSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-sm">{getField(item, "text") || item.text}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeChecklistItem(item.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    placeholder={t.preventive.addChecklistItem}
                    value={newChecklistText}
                    onChange={e => setNewChecklistText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addChecklistItem())}
                  />
                  <Button type="button" variant="outline" onClick={addChecklistItem}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPlanForm(false); setEditPlanId(null); setPlanForm(defaultPlanForm); }}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handlePlanSubmit}
              disabled={!computedPlanTitle || (!editPlanId && !planSectionId) || createBranchMut.isPending || updateBranchMut.isPending}
            >
              {createBranchMut.isPending || updateBranchMut.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Generate Work Order Dialog (الحل الهجين) ── */}
      <Dialog open={!!generateWOPlanId} onOpenChange={(o) => { if (!o) { setGenerateWOPlanId(null); setSelectedCandidateIds(new Set()); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.preventive.generateWorkOrder}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t.preventive.scheduledDate}</Label>
              <Input type="date" value={generateDate} onChange={e => setGenerateDate(e.target.value)} className="mt-1" />
            </div>

            {candidatesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> جاري التحقق من الفروع...
              </div>
            ) : candidatesQuery.data && candidatesQuery.data.needsSelection ? (
              <div className="space-y-2">
                <Label>هذا الفرع يحتوي على أكثر من فرع تنفيذي — اختر ما تريد تضمينه بأمر العمل:</Label>
                <div className="space-y-1.5 max-h-56 overflow-y-auto border rounded-md p-2">
                  {candidatesQuery.data.candidates.map((c: any) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCandidateIds.has(c.id)}
                        onChange={() => toggleCandidate(c.id)}
                        className="h-4 w-4"
                      />
                      <span>{c.title}</span>
                      {c.id === generateWOPlanId && <Badge variant="outline" className="text-xs">الفرع نفسه</Badge>}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  سيُنشأ أمر عمل واحد يضم كل بنود الفحص الخاصة بالفروع المُختارة أعلاه.
                </p>
              </div>
            ) : null}

            {/* ── معاينة: الفني المسؤول + قائمة التحقق كاملة قبل الإنشاء الفعلي ── */}
            {candidatesQuery.data && previewCandidates.length > 0 && (
              <div className="space-y-3 border rounded-md p-3 bg-muted/30">
                {previewCandidates.map((c: any) => (
                  <div key={c.id} className="space-y-1">
                    {previewCandidates.length > 1 && (
                      <p className="text-sm font-semibold">{c.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      الفني المسؤول:{" "}
                      <span className="font-medium text-foreground">
                        {(pmTechnicians.find((u: any) => u.id === c.assignedToId) as any)?.name
                          ?? users.find((u: any) => u.id === c.assignedToId)?.name
                          ?? "غير معيّن"}
                      </span>
                    </p>
                  </div>
                ))}

                <div className="space-y-1">
                  <Label className="text-xs">قائمة التحقق ({previewItemsQuery.data?.length ?? 0} بند)</Label>
                  {previewItemsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> جاري تحميل قائمة التحقق...
                    </div>
                  ) : previewItemsQuery.data && previewItemsQuery.data.length > 0 ? (
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-sm">
                      {previewItemsQuery.data.map((item: any) => (
                        <li key={item.id} className="flex items-start gap-1.5">
                          <span className="text-muted-foreground shrink-0">•</span>
                          <span>{item.text}</span>
                          {previewCandidates.length > 1 && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.planTitle}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">لا يوجد بنود فحص مضافة لهذا الفرع.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGenerateWOPlanId(null); setSelectedCandidateIds(new Set()); }}>{t.common.cancel}</Button>
            <Button
              onClick={handleCreateWorkOrder}
              disabled={createHybridWOMut.isPending || candidatesQuery.isLoading || selectedCandidateIds.size === 0}
            >
              {createHybridWOMut.isPending ? t.common.saving : t.preventive.generateWorkOrder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Work Order Detail Dialog ── */}
      {selectedWO && (
        <Dialog open={!!selectedWO} onOpenChange={(o) => { if (!o) { setSelectedWO(null); setCompletionPhotoUrl(""); } }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedWO.workOrderNumber} — {selectedWO.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* الحالة */}
              <div>
                <Label className="mb-1 block">{t.common.status}</Label>
                <Select
                  value={selectedWO.status}
                  onValueChange={v => setSelectedWO((w: any) => ({ ...w, status: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["scheduled","in_progress","completed","overdue","cancelled"] as WOStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{woStatusLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* قائمة التحقق مع ملاحظات لكل بند */}
              {selectedWO.checklistResults && selectedWO.checklistResults.length > 0 && (
                <div>
                  <Label className="mb-2 block">{t.preventive.checklist}</Label>
                  <div className="space-y-3">
                    {(selectedWO.checklistResults as ChecklistResult[]).map((item, idx) => (
                      <div key={item.id} className="bg-muted/30 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={item.done ?? false}
                            onCheckedChange={(checked) => {
                              const updated = [...selectedWO.checklistResults];
                              updated[idx] = { ...item, done: !!checked };
                              setSelectedWO((w: any) => ({ ...w, checklistResults: updated }));
                            }}
                          />
                          <span className={`flex-1 text-sm ${item.done ? "line-through text-muted-foreground" : ""}`}>{item.text}</span>
                        </div>
                        {/* حقل ملاحظات لكل بند */}
                        <Input
                          placeholder={t.common.optionalNote || "ملاحظة (اختياري)"}
                          value={item.notes ?? ""}
                          onChange={e => {
                            const updated = [...selectedWO.checklistResults];
                            updated[idx] = { ...item, notes: e.target.value };
                            setSelectedWO((w: any) => ({ ...w, checklistResults: updated }));
                          }}
                          className="text-xs h-8"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ملاحظات الفني */}
              <div>
                <Label>{t.preventive.technicianNotes}</Label>
                <Textarea
                  value={selectedWO.technicianNotes ?? getField(selectedWO, "technicianNotes") ?? ""}
                  onChange={e => setSelectedWO((w: any) => ({ ...w, technicianNotes: e.target.value }))}
                  rows={3}
                  className="mt-1"
                />
              </div>

              {/* صورة إتمام العمل */}
              <div>
                <Label className="mb-2 block">صورة إتمام العمل</Label>
                {(completionPhotoUrl || selectedWO.completionPhotoUrl) ? (
                  <div className="relative">
                    <img
                      src={mediaUrl(completionPhotoUrl || selectedWO.completionPhotoUrl)}
                      alt="completion"
                      className="rounded-lg max-h-48 w-full object-cover border"
                    />
                    <Button
                      variant="destructive" size="sm"
                      className="absolute top-2 left-2"
                      onClick={() => { setCompletionPhotoUrl(""); setSelectedWO((w: any) => ({ ...w, completionPhotoUrl: "" })); }}
                    >
                      {t.common.delete}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full gap-2" onClick={handleUploadCompletionPhoto} disabled={uploadingPhoto}>
                    {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {uploadingPhoto ? (t.common.uploading || "جاري الرفع...") : (t.preventive?.uploadCompletionPhoto || "رفع صورة إتمام العمل")}
                  </Button>
                )}
              </div>

              {/* تاريخ الإنجاز عند الإتمام */}
              {selectedWO.status === "completed" && (
                <div>
                  <Label>{t.preventive.completedDate}</Label>
                  <Input
                    type="date"
                    value={selectedWO.completedDate ? new Date(selectedWO.completedDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]}
                    onChange={e => setSelectedWO((w: any) => ({ ...w, completedDate: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSelectedWO(null); setCompletionPhotoUrl(""); }}>{t.common.cancel}</Button>
              <Button
                variant="outline"
                onClick={() => window.open(`/api/export/pm-work-order/${selectedWO.id}`, '_blank')}
                title="طباعة PDF"
              >
                📄 PDF
              </Button>
              <Button
                onClick={() => updateWOMut.mutate({
                  id: selectedWO.id,
                  status: selectedWO.status,
                  checklistResults: selectedWO.checklistResults ?? [],
                  technicianNotes: selectedWO.technicianNotes,
                  completionPhotoUrl: selectedWO.completionPhotoUrl || undefined,
                  completedDate: selectedWO.completedDate ?? undefined,
                })}
                disabled={updateWOMut.isPending}
              >
                {updateWOMut.isPending ? t.common.saving : t.common.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Preview Plan Dialog ── */}
      <Dialog open={!!previewPlan} onOpenChange={(o) => { if (!o) { setPreviewPlan(null); setPreviewPlanId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">{previewPlan && getField(previewPlan, "title")}</DialogTitle>
          </DialogHeader>
          {previewPlan && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t.common.status || "الحالة"}</span>
                <span>{previewPlan.isActive ? (t.common.active || "نشط") : (t.common.inactive || "متوقف")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t.preventive?.frequency || "التكرار"}</span>
                <span>{previewPlan.frequency}</span>
              </div>
              {previewPlan.estimatedDurationMinutes && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t.common.duration || "المدة"}</span>
                  <span>{previewPlan.estimatedDurationMinutes} {t.common.minutes || "دقيقة"}</span>
                </div>
              )}
              {previewPlan.nextDueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t.preventive?.nextDueDate || "الموعد القادم"}</span>
                  <span>{new Date(previewPlan.nextDueDate).toLocaleDateString()}</span>
                </div>
              )}
              {previewPlan.description && (
                <div>
                  <p className="text-muted-foreground mb-1">{t.common.description || "الوصف"}</p>
                  <p className="bg-muted/50 rounded-lg p-3 leading-relaxed">{getField(previewPlan, "description")}</p>
                </div>
              )}
              {(previewChecklistItems.length > 0 || (previewPlan.checklist && previewPlan.checklist.length > 0)) && (
                <div>
                  <p className="text-muted-foreground mb-2">
                    {t.preventive?.checklist || "قائمة الفحص"} ({previewChecklistItems.length || previewPlan.checklist?.length || 0})
                  </p>
                  <ul className="space-y-1">
                    {previewChecklistItems.length > 0
                      ? previewChecklistItems.map((item: any) => (
                          <li key={item.id} className="flex items-center gap-2 bg-muted/30 rounded-md p-2">
                            <ClipboardList className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{getField(item, "text") || item.text}</span>
                            {item.isRequired && <span className="text-xs text-red-500 mr-auto">*</span>}
                          </li>
                        ))
                      : (previewPlan.checklist ?? []).map((item: any, idx: number) => (
                          <li key={idx} className="flex items-center gap-2 bg-muted/30 rounded-md p-2">
                            <ClipboardList className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{item.text}</span>
                            {item.required && <span className="text-xs text-red-500 mr-auto">*</span>}
                          </li>
                        ))
                    }
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Plan Confirm ── */}
      <Dialog open={!!deletePlanId} onOpenChange={(o) => { if (!o) setDeletePlanId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.common.confirmDelete}</DialogTitle></DialogHeader>
          <p>{t.common.deleteWarning}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePlanId(null)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deletePlanId && deletePlanMut.mutate({ id: deletePlanId })} disabled={deletePlanMut.isPending}>
              {deletePlanMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Work Order Confirm (متاح فقط قبل بدء الفحص) ── */}
      <Dialog open={!!deleteWOId} onOpenChange={(o) => { if (!o) setDeleteWOId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف أمر العمل</DialogTitle></DialogHeader>
          <p>هل أنت متأكد من حذف أمر العمل هذا؟ لا يمكن التراجع عن هذا الإجراء.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteWOId(null)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteWOId && deleteWOMut.mutate({ id: deleteWOId })} disabled={deleteWOMut.isPending}>
              {deleteWOMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
