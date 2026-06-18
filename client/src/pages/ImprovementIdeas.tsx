import { trpc } from "@/lib/trpc";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Lightbulb, Search, Plus, ChevronLeft, ChevronRight, Trash2, Folder, ArrowRight,
  CloudUpload, X, ImageIcon, ExternalLink, CheckCircle2,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef, useCallback, DragEvent } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

const PAGE_SIZE = 10;
const MAX_IMAGES = 5;
// تحكم مؤقت: إخفاء حقلي الموقع والقسم بنافذة تقديم الفكرة (بدون حذف المنطق) — لإعادتها لاحقاً غيّر القيمة إلى true
const SHOW_SITE_SECTION_FIELDS = false;

const IDEA_STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  classified: "bg-amber-100 text-amber-700",
  approved: "bg-teal-100 text-teal-700",
  in_progress: "bg-violet-100 text-violet-700",
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

type FileEntry = { id: string; file: File; status: "pending" | "uploading" | "done" | "error"; progress: number; url?: string; fileKey?: string };

// ── مكوّن رفع الصور (حتى 5 صور) — يُستخدم بنافذة تقديم فكرة جديدة ──────────
function IdeaImageUploader({ fileEntries, setFileEntries }: { fileEntries: FileEntry[]; setFileEntries: React.Dispatch<React.SetStateAction<FileEntry[]>> }) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (entry: FileEntry) => {
    setFileEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "uploading", progress: 0 } : e));
    try {
      const formData = new FormData();
      formData.append("file", entry.file);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 90);
            setFileEntries(prev => prev.map(e => e.id === entry.id ? { ...e, progress: pct } : e));
          }
        };
        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (data.url) {
                setFileEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "done", progress: 100, url: data.url, fileKey: data.fileKey } : e));
                resolve();
              } else reject(new Error("no url"));
            } catch { reject(new Error("invalid response")); }
          } else reject(new Error(`upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("network error"));
        xhr.send(formData);
      });
    } catch (err: any) {
      setFileEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "error", progress: 0 } : e));
    }
  }, [setFileEntries]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    const room = MAX_IMAGES - fileEntries.length;
    if (room <= 0) { toast.error(`${t.improvementIdeas.attachImages} (${MAX_IMAGES})`); return; }
    const valid = arr.slice(0, room);
    const entries: FileEntry[] = valid.map(file => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, status: "pending", progress: 0 }));
    setFileEntries(prev => [...prev, ...entries]);
    entries.forEach(e => uploadFile(e));
  }, [fileEntries.length, setFileEntries, uploadFile, t]);

  const removeEntry = (id: string) => setFileEntries(prev => prev.filter(e => e.id !== id));

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        onClick={() => fileEntries.length < MAX_IMAGES && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"} ${fileEntries.length >= MAX_IMAGES ? "opacity-50 pointer-events-none" : ""}`}
      >
        <CloudUpload className="w-6 h-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">{t.improvementIdeas.attachImages} ({fileEntries.length}/{MAX_IMAGES})</p>
      </div>
      {fileEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileEntries.map(entry => (
            <div key={entry.id} className="relative w-16 h-16 rounded-md overflow-hidden border bg-muted shrink-0">
              {entry.url ? <img src={entry.url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>}
              {entry.status === "uploading" && <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-[10px]">{entry.progress}%</div>}
              <button onClick={(e) => { e.stopPropagation(); removeEntry(entry.id); }} className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── شارة صور المرفقات لعرض مصغّر داخل أي بطاقة/نافذة فكرة ──────────────────
function IdeaImagesPreview({ ideaId }: { ideaId: number }) {
  const { data: files = [] } = trpc.attachments.list.useQuery({ entityType: "improvement_idea", entityId: ideaId });
  if (!files.length) return null;
  return (
    <div className="flex gap-1.5 flex-wrap">
      {files.map((f: any) => (
        <a key={f.id} href={f.fileUrl} target="_blank" rel="noreferrer" className="w-12 h-12 rounded-md overflow-hidden border shrink-0">
          <img src={f.fileUrl} className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// نافذة تقديم فكرة جديدة (تتاح للجميع)
// ════════════════════════════════════════════════════════════════════════
function CreateIdeaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { getPriorityLabel } = useStaticLabels();
  const utils = trpc.useUtils();
  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: allSections } = trpc.sections.list.useQuery(undefined);

  const [form, setForm] = useState({ title: "", description: "", category: "operational", priority: "medium", expectedBenefit: "", siteId: "", sectionId: "" });
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const addAttachmentMut = trpc.attachments.add.useMutation();

  const resetForm = () => { setForm({ title: "", description: "", category: "operational", priority: "medium", expectedBenefit: "", siteId: "", sectionId: "" }); setFileEntries([]); };

  const createMutation = trpc.improvementIdeas.create.useMutation({
    onSuccess: async (res) => {
      const doneEntries = fileEntries.filter(e => e.status === "done" && e.url);
      for (const entry of doneEntries) {
        try {
          await addAttachmentMut.mutateAsync({
            entityType: "improvement_idea", entityId: res.id!, fileName: entry.file.name,
            fileUrl: entry.url!, fileKey: entry.fileKey || entry.file.name,
            mimeType: entry.file.type, fileSize: entry.file.size,
          });
        } catch { /* تجاهل فشل مرفق منفرد */ }
      }
      toast.success(`${t.improvementIdeas.createNew} ${res.requestNumber}`);
      utils.improvementIdeas.listPaginated.invalidate();
      onOpenChange(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!form.title.trim()) { toast.error(t.improvementIdeas.title); return; }
    const uploading = fileEntries.some(e => e.status === "uploading" || e.status === "pending");
    if (uploading) { toast.error(t.attachments?.uploading || "الرجاء انتظار اكتمال رفع الصور"); return; }
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

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t.improvementIdeas.createNew}</DialogTitle></DialogHeader>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(t.improvementIdeas.categories).map(k => <SelectItem key={k} value={k}>{(t.improvementIdeas.categories as any)[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t.improvementIdeas.priority}</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(t.priority).map(k => <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.improvementIdeas.expectedBenefit}</Label>
            <Textarea value={form.expectedBenefit} onChange={e => setForm(f => ({ ...f, expectedBenefit: e.target.value }))} />
          </div>
          {SHOW_SITE_SECTION_FIELDS && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.improvementIdeas.site}</Label>
                <Select value={form.siteId} onValueChange={v => setForm(f => ({ ...f, siteId: v, sectionId: "" }))}>
                  <SelectTrigger><SelectValue placeholder={t.improvementIdeas.site} /></SelectTrigger>
                  <SelectContent>{sites.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t.improvementIdeas.section}</Label>
                <Select value={form.sectionId} onValueChange={v => setForm(f => ({ ...f, sectionId: v }))} disabled={!form.siteId}>
                  <SelectTrigger><SelectValue placeholder={t.improvementIdeas.section} /></SelectTrigger>
                  <SelectContent>
                    {allSections?.filter((s: any) => s.siteId === Number(form.siteId)).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>{t.improvementIdeas.attachImages}</Label>
            <IdeaImageUploader fileEntries={fileEntries} setFileEntries={setFileEntries} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════
// نافذة الفرز والتصنيف (مدير الصيانة / مدير النظام / مالك النظام فقط)
// ════════════════════════════════════════════════════════════════════════
function ClassifyDialog({ idea, onClose }: { idea: any; onClose: () => void }) {
  const { t } = useTranslation();
  const { getPriorityLabel } = useStaticLabels();
  const utils = trpc.useUtils();
  const [category, setCategory] = useState(idea.category);
  const [groupCategory, setGroupCategory] = useState("");
  const [priority, setPriority] = useState(idea.priority);

  const classifyMut = trpc.improvementIdeas.classify.useMutation({
    onSuccess: () => {
      toast.success(t.improvementIdeas.classify);
      utils.improvementIdeas.listPaginated.invalidate();
      utils.improvementIdeas.getGroupedClassifiedCounts.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{idea.requestNumber}</span>{idea.title}
          </DialogTitle>
          <DialogDescription>{t.improvementIdeas.classifyHint}</DialogDescription>
        </DialogHeader>
        {idea.description && <p className="text-sm text-muted-foreground">{idea.description}</p>}
        <IdeaImagesPreview ideaId={idea.id} />
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label>{t.improvementIdeas.category}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(t.improvementIdeas.categories).map(k => <SelectItem key={k} value={k}>{(t.improvementIdeas.categories as any)[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.improvementIdeas.groupCategory}</Label>
            <Select value={groupCategory} onValueChange={setGroupCategory}>
              <SelectTrigger><SelectValue placeholder={t.improvementIdeas.groupCategory} /></SelectTrigger>
              <SelectContent>{Object.keys(t.improvementIdeas.groups).map(k => <SelectItem key={k} value={k}>{(t.improvementIdeas.groups as any)[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.improvementIdeas.priority}</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(t.priority).map(k => <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground pt-1">{t.improvementIdeas.classificationCriteriaHint}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button
            disabled={!groupCategory || classifyMut.isPending}
            onClick={() => classifyMut.mutate({ id: idea.id, category, groupCategory, priority })}
          >
            {t.improvementIdeas.classify}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════
// نافذة قرار الإدارة العليا
// ════════════════════════════════════════════════════════════════════════
function DecideDialog({ idea, onClose }: { idea: any; onClose: () => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [decision, setDecision] = useState<"approved" | "postponed" | "cancelled" | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [postponedUntil, setPostponedUntil] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const decideMut = trpc.improvementIdeas.decide.useMutation({
    onSuccess: () => {
      toast.success(t.common.savedSuccessfully);
      utils.improvementIdeas.getClassifiedByGroup.invalidate();
      utils.improvementIdeas.getGroupedClassifiedCounts.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!decision) return;
    if (decision === "postponed" && !postponedUntil) { toast.error(t.improvementIdeas.postponedUntil); return; }
    decideMut.mutate({
      id: idea.id, decision,
      decisionNotes: decisionNotes || undefined,
      postponedUntil: decision === "postponed" ? postponedUntil : undefined,
      cancelReason: decision === "cancelled" ? (cancelReason || undefined) : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{idea.requestNumber}</span>{idea.title}
          </DialogTitle>
        </DialogHeader>
        {idea.description && <p className="text-sm text-muted-foreground">{idea.description}</p>}
        <IdeaImagesPreview ideaId={idea.id} />
        {idea.expectedBenefit && <p className="text-sm"><span className="font-medium">{t.improvementIdeas.expectedBenefit}: </span>{idea.expectedBenefit}</p>}
        <div className="flex gap-2 pt-2">
          <Button size="sm" className="flex-1" variant={decision === "approved" ? "default" : "outline"} onClick={() => setDecision("approved")}>{t.improvementIdeas.approve}</Button>
          <Button size="sm" className="flex-1" variant={decision === "postponed" ? "default" : "outline"} onClick={() => setDecision("postponed")}>{t.improvementIdeas.postpone}</Button>
          <Button size="sm" className="flex-1" variant={decision === "cancelled" ? "destructive" : "outline"} onClick={() => setDecision("cancelled")}>{t.improvementIdeas.cancel}</Button>
        </div>
        {decision === "postponed" && (
          <div className="space-y-1"><Label className="text-xs">{t.improvementIdeas.postponedUntil}</Label><Input type="date" value={postponedUntil} onChange={e => setPostponedUntil(e.target.value)} /></div>
        )}
        {decision === "cancelled" && (
          <div className="space-y-1"><Label className="text-xs">{t.improvementIdeas.cancelReason}</Label><Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></div>
        )}
        {decision && (
          <div className="space-y-1"><Label className="text-xs">{t.improvementIdeas.decisionNotes}</Label><Textarea value={decisionNotes} onChange={e => setDecisionNotes(e.target.value)} /></div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button disabled={!decision || decideMut.isPending} onClick={handleSubmit}>{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════
// تبويب: الأفكار الجديدة
// ════════════════════════════════════════════════════════════════════════
function NewIdeasTab({ canClassify }: { canClassify: boolean }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [classifyTarget, setClassifyTarget] = useState<any>(null);
  const { data, isLoading } = trpc.improvementIdeas.listPaginated.useQuery({ status: "new", page, pageSize: PAGE_SIZE }, { placeholderData: keepPreviousData });
  const ideas = data?.ideas ?? [];

  if (isLoading) return <div className="space-y-2 pt-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (!ideas.length) return <p className="text-center text-muted-foreground py-12">{t.improvementIdeas.noIdeas}</p>;

  return (
    <div className="space-y-2 pt-3">
      {ideas.map((idea: any) => (
        <Card key={idea.id} className={canClassify ? "cursor-pointer hover:shadow-md transition-shadow" : ""} onClick={() => canClassify && setClassifyTarget(idea)}>
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                <Badge variant="outline" className="text-xs">{(t.improvementIdeas.categories as any)[idea.category] || idea.category}</Badge>
              </div>
              <p className="font-medium truncate">{idea.title}</p>
              <p className="text-xs text-muted-foreground">{idea.submitterName || "—"}</p>
            </div>
            {canClassify && <Button size="sm" variant="outline">{t.improvementIdeas.classify}</Button>}
          </CardContent>
        </Card>
      ))}
      {data && data.totalPages > 1 && (
        <div className="flex justify-center pt-2">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page > 1) setPage(page - 1); }} className={page <= 1 ? "pointer-events-none opacity-50" : ""}><ChevronLeft className="w-4 h-4" /></PaginationLink></PaginationItem>
              {getPageNumbers(page, data.totalPages).map((p, i) => p === "dots" ? <PaginationItem key={i}><PaginationEllipsis /></PaginationItem> : <PaginationItem key={p}><PaginationLink href="#" isActive={p === page} onClick={e => { e.preventDefault(); setPage(p as number); }}>{p}</PaginationLink></PaginationItem>)}
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page < data.totalPages) setPage(page + 1); }} className={page >= data.totalPages ? "pointer-events-none opacity-50" : ""}><ChevronRight className="w-4 h-4" /></PaginationLink></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
      {classifyTarget && <ClassifyDialog idea={classifyTarget} onClose={() => setClassifyTarget(null)} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// تبويب: الأفكار المصنّفة (مجلدات)
// ════════════════════════════════════════════════════════════════════════
function ClassifiedTab({ canDecide }: { canDecide: boolean }) {
  const { t } = useTranslation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [decideTarget, setDecideTarget] = useState<any>(null);
  const { data: counts = [], isLoading } = trpc.improvementIdeas.getGroupedClassifiedCounts.useQuery();
  const { data: groupIdeas = [], isLoading: loadingGroup } = trpc.improvementIdeas.getClassifiedByGroup.useQuery({ groupCategory: openGroup! }, { enabled: !!openGroup });

  if (openGroup) {
    return (
      <div className="space-y-2 pt-3">
        <Button variant="ghost" size="sm" onClick={() => setOpenGroup(null)}><ArrowRight className="w-4 h-4 ml-1" />{t.improvementIdeas.folders}</Button>
        <p className="font-medium flex items-center gap-2"><Folder className="w-4 h-4" />{(t.improvementIdeas.groups as any)[openGroup]}</p>
        {loadingGroup ? <Skeleton className="h-20 w-full" /> : !groupIdeas.length ? <p className="text-center text-muted-foreground py-8">{t.improvementIdeas.noIdeas}</p> : (
          groupIdeas.map((idea: any) => (
            <Card key={idea.id} className={canDecide ? "cursor-pointer hover:shadow-md transition-shadow" : ""} onClick={() => canDecide && setDecideTarget(idea)}>
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                  <p className="font-medium truncate">{idea.title}</p>
                  <p className="text-xs text-muted-foreground">{idea.submitterName || "—"}</p>
                </div>
                <Badge className={`border ${PRIORITY_COLORS[idea.priority] || ""}`}>{idea.priority}</Badge>
              </CardContent>
            </Card>
          ))
        )}
        {decideTarget && <DecideDialog idea={decideTarget} onClose={() => setDecideTarget(null)} />}
      </div>
    );
  }

  if (isLoading) return <div className="grid grid-cols-2 gap-3 pt-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (!counts.length) return <p className="text-center text-muted-foreground py-12">{t.improvementIdeas.noIdeas}</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
      {counts.map((c: any) => (
        <Card key={c.groupCategory} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setOpenGroup(c.groupCategory)}>
          <CardContent className="p-4 flex items-center gap-3">
            <Folder className="w-5 h-5 text-amber-500 shrink-0" />
            <span className="font-medium">{(t.improvementIdeas.groups as any)[c.groupCategory] || c.groupCategory}</span>
            <Badge variant="outline" className="mr-auto">{c.count}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// تبويب: المقترحات المعتمدة (تحويل + تتبّع)
// ════════════════════════════════════════════════════════════════════════
function ApprovedTab() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: ideas = [], isLoading } = trpc.improvementIdeas.getApproved.useQuery();
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");

  const completeMut = trpc.improvementIdeas.complete.useMutation({
    onSuccess: () => { toast.success(t.improvementIdeas.complete); utils.improvementIdeas.getApproved.invalidate(); setCompletingId(null); setCompletionNotes(""); },
    onError: (err) => toast.error(err.message),
  });

  const convert = (idea: any, type: "ticket" | "po") => {
    const titleParam = encodeURIComponent(idea.title);
    const descParam = encodeURIComponent(idea.description || "");
    if (type === "ticket") {
      setLocation(`/tickets/new?prefillTitle=${titleParam}&prefillDescription=${descParam}&fromIdeaId=${idea.id}`);
    } else {
      const notesParam = encodeURIComponent(`[${idea.requestNumber}] ${idea.title}\n${idea.description || ""}`);
      setLocation(`/purchase-orders/new?prefillNotes=${notesParam}&fromIdeaId=${idea.id}`);
    }
  };

  if (isLoading) return <div className="space-y-2 pt-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (!ideas.length) return <p className="text-center text-muted-foreground py-12">{t.improvementIdeas.noIdeas}</p>;

  return (
    <div className="space-y-2 pt-3">
      {ideas.map((idea: any) => (
        <Card key={idea.id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                <p className="font-medium truncate">{idea.title}</p>
              </div>
              <Badge className={IDEA_STATUS_COLORS[idea.status]}>{(t.improvementIdeas.statuses as any)[idea.status]}</Badge>
            </div>

            {idea.status === "approved" && (
              <Select onValueChange={(v) => convert(idea, v as "ticket" | "po")}>
                <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder={t.improvementIdeas.convertTo} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket">{t.improvementIdeas.convertToTicket}</SelectItem>
                  <SelectItem value="po">{t.improvementIdeas.convertToPurchaseOrder}</SelectItem>
                </SelectContent>
              </Select>
            )}

            {idea.status === "in_progress" && (
              <div className="space-y-2 text-sm">
                {idea.linkedTicketNumber && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">{t.improvementIdeas.linkedTicket}: {idea.linkedTicketNumber} — {idea.linkedTicketStatus}</span>
                    <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setLocation(`/tickets/${idea.linkedTicketId}`)}><ExternalLink className="w-3 h-3 ml-1" />{t.improvementIdeas.goToLinked}</Button>
                  </div>
                )}
                {idea.linkedPONumber && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">{t.improvementIdeas.linkedPurchaseOrder}: {idea.linkedPONumber} — {idea.linkedPOStatus}</span>
                    <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setLocation(`/purchase-orders/${idea.linkedPurchaseOrderId}`)}><ExternalLink className="w-3 h-3 ml-1" />{t.improvementIdeas.goToLinked}</Button>
                  </div>
                )}
                {completingId === idea.id ? (
                  <div className="space-y-2">
                    <Textarea placeholder={t.improvementIdeas.completionNotes} value={completionNotes} onChange={e => setCompletionNotes(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => completeMut.mutate({ id: idea.id, completionNotes: completionNotes || undefined })} disabled={completeMut.isPending}>{t.improvementIdeas.complete}</Button>
                      <Button size="sm" variant="outline" onClick={() => setCompletingId(null)}>{t.common.cancel}</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setCompletingId(idea.id)}><CheckCircle2 className="w-4 h-4 ml-1" />{t.improvementIdeas.complete}</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// تبويب: الكل (قائمة كاملة قابلة للفلترة)
// ════════════════════════════════════════════════════════════════════════
function AllIdeasTab() {
  const { t } = useTranslation();
  const { getPriorityLabel } = useStaticLabels();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const { data, isLoading } = trpc.improvementIdeas.listPaginated.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: search || undefined, page, pageSize: PAGE_SIZE,
  }, { placeholderData: keepPreviousData });
  const ideas = data?.ideas ?? [];

  return (
    <div className="space-y-3 pt-3">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={`${t.common.search}...`} value={search} onChange={e => setSearch(e.target.value)} className="pr-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {Object.keys(t.improvementIdeas.statuses).map(k => <SelectItem key={k} value={k}>{(t.improvementIdeas.statuses as any)[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> : !ideas.length ? (
        <p className="text-center text-muted-foreground py-12">{t.improvementIdeas.noIdeas}</p>
      ) : (
        <div className="space-y-2">
          {ideas.map((idea: any) => (
            <Card key={idea.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                  <p className="font-medium truncate">{idea.title}</p>
                  <p className="text-xs text-muted-foreground">{idea.submitterName || "—"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`border ${PRIORITY_COLORS[idea.priority] || ""}`}>{getPriorityLabel(idea.priority)}</Badge>
                  <Badge className={IDEA_STATUS_COLORS[idea.status]}>{(t.improvementIdeas.statuses as any)[idea.status]}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page > 1) setPage(page - 1); }} className={page <= 1 ? "pointer-events-none opacity-50" : ""}><ChevronLeft className="w-4 h-4" /></PaginationLink></PaginationItem>
              {getPageNumbers(page, data.totalPages).map((p, i) => p === "dots" ? <PaginationItem key={i}><PaginationEllipsis /></PaginationItem> : <PaginationItem key={p}><PaginationLink href="#" isActive={p === page} onClick={e => { e.preventDefault(); setPage(p as number); }}>{p}</PaginationLink></PaginationItem>)}
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page < data.totalPages) setPage(page + 1); }} className={page >= data.totalPages ? "pointer-events-none opacity-50" : ""}><ChevronRight className="w-4 h-4" /></PaginationLink></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// عرض الموظف العادي: "أفكاري" فقط — بدون أي بيانات داخلية عن المراجعة/القرار
// ════════════════════════════════════════════════════════════════════════
function MyIdeasView({ onCreateClick }: { onCreateClick: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = trpc.improvementIdeas.listPaginated.useQuery({ page, pageSize: PAGE_SIZE }, { placeholderData: keepPreviousData });
  const ideas = data?.ideas ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><Lightbulb className="w-6 h-6 text-amber-500" /><h1 className="text-xl font-bold">{t.improvementIdeas.myIdeas}</h1></div>
        <Button onClick={onCreateClick}><Plus className="w-4 h-4 ml-1" />{t.improvementIdeas.createNew}</Button>
      </div>
      {isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div> : !ideas.length ? (
        <p className="text-center text-muted-foreground py-12">{t.improvementIdeas.noIdeas}</p>
      ) : (
        <div className="space-y-2">
          {ideas.map((idea: any) => (
            <Card key={idea.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-xs text-muted-foreground font-mono">{idea.requestNumber}</span>
                    <p className="font-medium truncate">{idea.title}</p>
                  </div>
                  <Badge className={IDEA_STATUS_COLORS[idea.status]}>{(t.improvementIdeas.statuses as any)[idea.status]}</Badge>
                </div>
                {idea.description && <p className="text-sm text-muted-foreground">{idea.description}</p>}
                <IdeaImagesPreview ideaId={idea.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page > 1) setPage(page - 1); }} className={page <= 1 ? "pointer-events-none opacity-50" : ""}><ChevronLeft className="w-4 h-4" /></PaginationLink></PaginationItem>
              {getPageNumbers(page, data.totalPages).map((p, i) => p === "dots" ? <PaginationItem key={i}><PaginationEllipsis /></PaginationItem> : <PaginationItem key={p}><PaginationLink href="#" isActive={p === page} onClick={e => { e.preventDefault(); setPage(p as number); }}>{p}</PaginationLink></PaginationItem>)}
              <PaginationItem><PaginationLink href="#" onClick={e => { e.preventDefault(); if (page < data.totalPages) setPage(page + 1); }} className={page >= data.totalPages ? "pointer-events-none opacity-50" : ""}><ChevronRight className="w-4 h-4" /></PaginationLink></PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// المكوّن الرئيسي
// ════════════════════════════════════════════════════════════════════════
export default function ImprovementIdeas() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  const isTriageRole = !!user && ["maintenance_manager", "owner", "admin"].includes(user.role);
  const isSeniorMgmt = !!user && user.role === "senior_management";
  const isElevated = isTriageRole || isSeniorMgmt;
  // صلاحية القرار النهائي: الإدارة العليا + owner/admin (نفس قاعدة التجاوز الشامل المعتمدة بكل النظام)
  const canDecide = isSeniorMgmt || (!!user && ["owner", "admin"].includes(user.role));

  const [activeTab, setActiveTab] = useState(isSeniorMgmt ? "classified" : "new");

  if (!isElevated) {
    return (
      <>
        <MyIdeasView onCreateClick={() => setCreateOpen(true)} />
        <CreateIdeaDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><Lightbulb className="w-6 h-6 text-amber-500" /><h1 className="text-xl font-bold">{t.improvementIdeas.pageTitle}</h1></div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 ml-1" />{t.improvementIdeas.createNew}</Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {isTriageRole && <TabsTrigger value="new">{t.improvementIdeas.newIdeasTab}</TabsTrigger>}
          <TabsTrigger value="classified">{t.improvementIdeas.classifiedTab}</TabsTrigger>
          {isSeniorMgmt && <TabsTrigger value="new">{t.improvementIdeas.newIdeasTab}</TabsTrigger>}
          {isTriageRole && <TabsTrigger value="approved">{t.improvementIdeas.approvedTab}</TabsTrigger>}
          {isTriageRole && <TabsTrigger value="all">{t.improvementIdeas.allTab}</TabsTrigger>}
        </TabsList>
        <TabsContent value="new"><NewIdeasTab canClassify={isTriageRole} /></TabsContent>
        <TabsContent value="classified"><ClassifiedTab canDecide={canDecide} /></TabsContent>
        {isTriageRole && <TabsContent value="approved"><ApprovedTab /></TabsContent>}
        {isTriageRole && <TabsContent value="all"><AllIdeasTab /></TabsContent>}
      </Tabs>

      <CreateIdeaDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
