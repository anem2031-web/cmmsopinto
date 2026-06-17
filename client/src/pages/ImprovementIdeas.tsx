import { trpc } from "@/lib/trpc";
import { keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { TechnicianCombobox } from "@/components/TechnicianCombobox";
import { Lightbulb, Search, Plus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

const PAGE_SIZE = 10;

const IDEA_STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  pending_decision: "bg-amber-100 text-amber-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-emerald-100 text-emerald-700",
  postponed: "bg-orange-100 text-orange-700",
  cancelled: "bg-gray-100 text-gray-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

// يبني قائمة أرقام الصفحات المطلوب عرضها (مع نقاط حذف عند كثرة الصفحات)
function getPageNumbers(current: number, total: number): (number | "dots")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  const range: (number | "dots")[] = [1];
  if (left > 2) range.push("dots");
  for (let i = left; i <= right; i++) range.push(i);
  if (right < total - 1) range.push("dots");
  range.push(total);
  return range;
}

export default function ImprovementIdeas() {
  const { t } = useTranslation();
  const { getPriorityLabel } = useStaticLabels();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const getStatusLabel = (s: string) => (t.improvementIdeas.statuses as any)[s] || s;
  const getCategoryLabel = (c: string) => (t.improvementIdeas.categories as any)[c] || c;

  const canTriage = user && ["supervisor", "maintenance_manager", "owner", "admin"].includes(user.role);
  const canDecide = user && ["senior_management", "owner", "admin"].includes(user.role);

  // ── فلاتر وصفحات ──
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [search, statusFilter, categoryFilter, priorityFilter]);

  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: allSections } = trpc.sections.list.useQuery(undefined);
  const { data: allUsers = [] } = trpc.users.list.useQuery();

  const { data: ideasData, isLoading } = trpc.improvementIdeas.listPaginated.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  }, { placeholderData: keepPreviousData });

  const ideas = ideasData?.ideas ?? [];
  const totalIdeas = ideasData?.total ?? 0;
  const totalPages = ideasData?.totalPages ?? 1;
  const pageNumbers = useMemo(() => getPageNumbers(page, totalPages), [page, totalPages]);

  // ── نافذة تقديم فكرة جديدة ──
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", category: "", priority: "medium",
    expectedBenefit: "", siteId: "", sectionId: "",
  });

  const resetForm = () => setForm({ title: "", description: "", category: "", priority: "medium", expectedBenefit: "", siteId: "", sectionId: "" });

  const createMutation = trpc.improvementIdeas.create.useMutation({
    onSuccess: (res) => {
      toast.success(`تم تقديم الفكرة بنجاح برقم ${res.requestNumber}`);
      utils.improvementIdeas.listPaginated.invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!form.title.trim() || !form.category) { toast.error("العنوان والتصنيف مطلوبان"); return; }
    createMutation.mutate({
      title: form.title,
      description: form.description || undefined,
      category: form.category,
      priority: form.priority,
      expectedBenefit: form.expectedBenefit || undefined,
      siteId: form.siteId ? Number(form.siteId) : undefined,
      sectionId: form.sectionId ? Number(form.sectionId) : undefined,
    });
  };

  // ── نافذة التفاصيل/الإجراء ──
  const [selectedIdea, setSelectedIdea] = useState<any>(null);
  const [decision, setDecision] = useState<"approved" | "postponed" | "cancelled" | null>(null);
  const [assignedToId, setAssignedToId] = useState("");
  const [postponedUntil, setPostponedUntil] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");

  const openDetail = (idea: any) => {
    setSelectedIdea(idea);
    setDecision(null);
    setAssignedToId("");
    setPostponedUntil("");
    setCancelReason("");
    setDecisionNotes("");
    setCompletionNotes("");
  };

  const invalidateAll = () => {
    utils.improvementIdeas.listPaginated.invalidate();
    setSelectedIdea(null);
  };

  const triageMutation = trpc.improvementIdeas.triage.useMutation({
    onSuccess: () => { toast.success("تم فرز الفكرة وإرسالها للإدارة العليا"); invalidateAll(); },
    onError: (err) => toast.error(err.message),
  });

  const decideMutation = trpc.improvementIdeas.decide.useMutation({
    onSuccess: () => { toast.success("تم تسجيل القرار"); invalidateAll(); },
    onError: (err) => toast.error(err.message),
  });

  const completeMutation = trpc.improvementIdeas.complete.useMutation({
    onSuccess: () => { toast.success("تم تأكيد إكمال التنفيذ"); invalidateAll(); },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.improvementIdeas.delete.useMutation({
    onSuccess: () => { toast.success(t.common.deletedSuccessfully); invalidateAll(); },
    onError: (err) => toast.error(err.message),
  });

  const handleDecide = () => {
    if (!decision) return;
    if (decision === "approved" && !assignedToId) { toast.error("حدد الشخص المكلَّف بالتنفيذ"); return; }
    if (decision === "postponed" && !postponedUntil) { toast.error("حدد تاريخ التأجيل"); return; }
    decideMutation.mutate({
      id: selectedIdea.id,
      decision,
      decisionNotes: decisionNotes || undefined,
      assignedToId: decision === "approved" ? Number(assignedToId) : undefined,
      postponedUntil: decision === "postponed" ? postponedUntil : undefined,
      cancelReason: decision === "cancelled" ? cancelReason || undefined : undefined,
    });
  };

  const canCompleteSelected = selectedIdea && (selectedIdea.assignedToId === user?.id || ["admin", "owner"].includes(user?.role || ""));
  const canDeleteSelected = selectedIdea && ((selectedIdea.submittedById === user?.id && selectedIdea.status === "new") || ["admin", "owner"].includes(user?.role || ""));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-amber-500" />
          <h1 className="text-xl font-bold">{t.improvementIdeas.pageTitle}</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 ml-1" /> {t.improvementIdeas.createNew}
        </Button>
      </div>

      {/* الفلاتر */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground">{t.common.search}</span>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={`${t.common.search}...`} value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.improvementIdeas.status}</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.improvementIdeas.statuses).map(k => (
                <SelectItem key={k} value={k}>{getStatusLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.improvementIdeas.category}</span>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.improvementIdeas.categories).map(k => (
                <SelectItem key={k} value={k}>{getCategoryLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.improvementIdeas.priority}</span>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.priority).map(k => (
                <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* القائمة */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : ideas.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">{t.improvementIdeas.noIdeas}</div>
      ) : (
        <div className="space-y-2">
          {ideas.map((idea: any) => (
            <Card key={idea.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openDetail(idea)}>
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                    <Badge variant="outline" className="text-xs">{getCategoryLabel(idea.category)}</Badge>
                  </div>
                  <p className="font-medium truncate">{idea.title}</p>
                  <p className="text-xs text-muted-foreground">{idea.submitterName || "—"} · {new Date(idea.createdAt).toLocaleDateString("ar-SA")}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`border ${PRIORITY_COLORS[idea.priority] || ""}`}>{getPriorityLabel(idea.priority)}</Badge>
                  <Badge className={IDEA_STATUS_COLORS[idea.status] || "bg-gray-100 text-gray-700"}>{getStatusLabel(idea.status)}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && ideas.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">{t.improvementIdeas.results}: {totalIdeas}</span>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink href="#" size="default" aria-label={t.common.previous}
                    onClick={e => { e.preventDefault(); if (page > 1) setPage(page - 1); }}
                    className={`gap-1 px-2.5 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}>
                    <ChevronLeft className="w-4 h-4" /><span className="hidden sm:block">{t.common.previous}</span>
                  </PaginationLink>
                </PaginationItem>
                {pageNumbers.map((p, idx) => p === "dots" ? (
                  <PaginationItem key={`dots-${idx}`}><PaginationEllipsis /></PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink href="#" isActive={p === page} onClick={e => { e.preventDefault(); setPage(p as number); }}>{p}</PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationLink href="#" size="default" aria-label={t.common.next}
                    onClick={e => { e.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                    className={`gap-1 px-2.5 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}>
                    <span className="hidden sm:block">{t.common.next}</span><ChevronRight className="w-4 h-4" />
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {/* نافذة تقديم فكرة جديدة */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.improvementIdeas.createNew}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t.improvementIdeas.title}</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t.improvementIdeas.description}</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.improvementIdeas.category}</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder={t.improvementIdeas.category} /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.improvementIdeas.categories).map(k => (
                      <SelectItem key={k} value={k}>{getCategoryLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t.improvementIdeas.priority}</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.priority).map(k => (
                      <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.improvementIdeas.site}</Label>
                <Select value={form.siteId} onValueChange={v => setForm(f => ({ ...f, siteId: v, sectionId: "" }))}>
                  <SelectTrigger><SelectValue placeholder={t.improvementIdeas.site} /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t.improvementIdeas.section}</Label>
                <Select value={form.sectionId} onValueChange={v => setForm(f => ({ ...f, sectionId: v }))} disabled={!form.siteId}>
                  <SelectTrigger><SelectValue placeholder={t.improvementIdeas.section} /></SelectTrigger>
                  <SelectContent>
                    {allSections?.filter((s: any) => s.siteId === Number(form.siteId)).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.improvementIdeas.expectedBenefit}</Label>
              <Textarea value={form.expectedBenefit} onChange={e => setForm(f => ({ ...f, expectedBenefit: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة التفاصيل والإجراءات */}
      <Dialog open={!!selectedIdea} onOpenChange={(o) => !o && setSelectedIdea(null)}>
        <DialogContent className="max-w-lg">
          {selectedIdea && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-muted-foreground">{selectedIdea.requestNumber}</span>
                  <Badge className={IDEA_STATUS_COLORS[selectedIdea.status] || ""}>{getStatusLabel(selectedIdea.status)}</Badge>
                </DialogTitle>
                <DialogDescription>{selectedIdea.title}</DialogDescription>
              </DialogHeader>

              <div className="space-y-2 text-sm">
                {selectedIdea.description && <p className="text-muted-foreground">{selectedIdea.description}</p>}
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2 border-t">
                  <span>{t.improvementIdeas.category}: {getCategoryLabel(selectedIdea.category)}</span>
                  <span>{t.improvementIdeas.priority}: {getPriorityLabel(selectedIdea.priority)}</span>
                  <span>{t.improvementIdeas.submittedBy}: {selectedIdea.submitterName || "—"}</span>
                  {selectedIdea.siteName && <span>{t.improvementIdeas.site}: {selectedIdea.siteName}</span>}
                  {selectedIdea.assigneeName && <span>{t.improvementIdeas.assignedTo}: {selectedIdea.assigneeName}</span>}
                  {selectedIdea.expectedBenefit && <span className="col-span-2">{t.improvementIdeas.expectedBenefit}: {selectedIdea.expectedBenefit}</span>}
                </div>
              </div>

              {/* فرز */}
              {selectedIdea.status === "new" && canTriage && (
                <div className="border-t pt-3">
                  <Button className="w-full" onClick={() => triageMutation.mutate({ id: selectedIdea.id })} disabled={triageMutation.isPending}>
                    {t.improvementIdeas.triage}
                  </Button>
                </div>
              )}

              {/* قرار الإدارة العليا */}
              {selectedIdea.status === "pending_decision" && canDecide && (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant={decision === "approved" ? "default" : "outline"} className="flex-1" onClick={() => setDecision("approved")}>{t.improvementIdeas.approve}</Button>
                    <Button size="sm" variant={decision === "postponed" ? "default" : "outline"} className="flex-1" onClick={() => setDecision("postponed")}>{t.improvementIdeas.postpone}</Button>
                    <Button size="sm" variant={decision === "cancelled" ? "destructive" : "outline"} className="flex-1" onClick={() => setDecision("cancelled")}>{t.improvementIdeas.cancel}</Button>
                  </div>
                  {decision === "approved" && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t.improvementIdeas.assignedTo}</Label>
                      <TechnicianCombobox
                        value={assignedToId}
                        onValueChange={setAssignedToId}
                        placeholder={t.improvementIdeas.selectAssignee}
                        options={allUsers.map((u: any) => ({ value: String(u.id), label: u.name || u.email }))}
                      />
                    </div>
                  )}
                  {decision === "postponed" && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t.improvementIdeas.postponedUntil}</Label>
                      <Input type="date" value={postponedUntil} onChange={e => setPostponedUntil(e.target.value)} />
                    </div>
                  )}
                  {decision === "cancelled" && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t.improvementIdeas.cancelReason}</Label>
                      <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                    </div>
                  )}
                  {decision && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t.improvementIdeas.decisionNotes}</Label>
                      <Textarea value={decisionNotes} onChange={e => setDecisionNotes(e.target.value)} />
                      <Button className="w-full mt-2" onClick={handleDecide} disabled={decideMutation.isPending}>{t.common.save}</Button>
                    </div>
                  )}
                </div>
              )}

              {/* إكمال التنفيذ */}
              {selectedIdea.status === "in_progress" && canCompleteSelected && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs">{t.improvementIdeas.completionNotes}</Label>
                  <Textarea value={completionNotes} onChange={e => setCompletionNotes(e.target.value)} />
                  <Button className="w-full" onClick={() => completeMutation.mutate({ id: selectedIdea.id, completionNotes: completionNotes || undefined })} disabled={completeMutation.isPending}>
                    {t.improvementIdeas.complete}
                  </Button>
                </div>
              )}

              {canDeleteSelected && (
                <DialogFooter>
                  <Button variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate({ id: selectedIdea.id })} disabled={deleteMutation.isPending}>
                    <Trash2 className="w-4 h-4 ml-1" /> {t.common.delete}
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
