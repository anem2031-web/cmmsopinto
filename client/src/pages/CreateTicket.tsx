import { trpc } from "@/lib/trpc";
import { getLocalizedName } from "@/hooks/useTranslatedField";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Upload, Loader2, X, FileText, CheckCircle2, AlertCircle, CloudUpload } from "lucide-react";
import { useState, useRef, useCallback, useEffect, DragEvent } from "react";
import { toast } from "sonner";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type FileStatus = "pending" | "uploading" | "done" | "error";

type FileEntry = {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  url?: string;
  error?: string;
};

export default function CreateTicket() {
  const { t: tr } = useLanguage();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { t, language } = useTranslation();
  const { getPriorityLabel, getCategoryLabel } = useStaticLabels();
  const { data: sites } = trpc.sites.list.useQuery();

  const [form, setForm] = useState({
    title: "", description: "", priority: "medium",
    category: "general", siteId: "", sectionId: "", assetId: "", locationDetail: "", beforePhotoUrl: "",
  });

  const { data: assets } = trpc.assets.list.useQuery(
    form.sectionId ? { sectionId: Number(form.sectionId) } : {},
  );
  // Pre-fill form from URL params (e.g. from NFC scan)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const assetId = params.get("assetId");
    const siteId = params.get("siteId");
    const sectionId = params.get("sectionId");
    const locationDetail = params.get("locationDetail");
    if (assetId || siteId || sectionId || locationDetail) {
      setForm(prev => ({
        ...prev,
        ...(assetId && { assetId }),
        ...(siteId && { siteId }),
        ...(sectionId && { sectionId }),
        ...(locationDetail && { locationDetail }),
      }));
    }
  }, [search]);

  const { data: sections } = trpc.sections.list.useQuery(
    form.siteId ? { siteId: Number(form.siteId) } : undefined,
    { enabled: !!form.siteId }
  );
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const at = (t as any).attachments || {};

  const createAttachmentMut = trpc.attachments.add.useMutation();

  const createMut = trpc.tickets.create.useMutation({
    onSuccess: async (data) => {
      const doneEntries = fileEntries.filter(e => e.status === "done" && e.url);
      for (const entry of doneEntries) {
        try {
          await createAttachmentMut.mutateAsync({
            entityType: "ticket",
            entityId: data.id!,
            fileName: entry.file.name,
            fileUrl: entry.url!,
            fileKey: entry.url!.split("/").pop() || entry.file.name,
            mimeType: entry.file.type,
            fileSize: entry.file.size,
          });
        } catch (err) {
          console.error("Failed to save attachment:", err);
        }
      }
      toast.success(`${t.tickets.createNew} ${data.ticketNumber}`);
      setLocation(`/tickets/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadFile = useCallback(async (entry: FileEntry) => {
    setFileEntries(prev =>
      prev.map(e => e.id === entry.id ? { ...e, status: "uploading", progress: 0 } : e)
    );

    try {
      const formData = new FormData();
      formData.append("file", entry.file);

      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 90); // 90% for upload
            setFileEntries(prev =>
              prev.map(e => e.id === entry.id ? { ...e, progress: pct } : e)
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (data.url) {
                setFileEntries(prev =>
                  prev.map(e => {
                    if (e.id !== entry.id) return e;
                    return { ...e, status: "done", progress: 100, url: data.url };
                  })
                );
                // Set first image as beforePhotoUrl
                if (entry.file.type.startsWith("image/")) {
                  setForm(f => f.beforePhotoUrl ? f : { ...f, beforePhotoUrl: data.url });
                }
                resolve();
              } else {
                reject(new Error("No URL returned"));
              }
            } catch {
              reject(new Error("Invalid response"));
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
    } catch (err: any) {
      setFileEntries(prev =>
        prev.map(e => e.id === entry.id
          ? { ...e, status: "error", progress: 0, error: err.message }
          : e
        )
      );
    }
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
const allowed = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

    const currentImagesCount =
  fileEntries.filter(e => e.file.type.startsWith("image/")).length;

const incomingImagesCount =
  fileArray.filter(f => f.type.startsWith("image/")).length;

if (currentImagesCount + incomingImagesCount > 4) {
  toast.error("الحد الأقصى 4 صور للبلاغ");
  return;
}

const valid = fileArray.filter(f => {
      if (!allowed.includes(f.type) && !f.type.startsWith("image/")) {
        toast.error(`${at.invalidFileType || "نوع ملف غير مدعوم"}: ${f.name}`);
        return false;
      }
const maxSize = f.type.startsWith("video/")
  ? 10 * 1024 * 1024
  : 10 * 1024 * 1024;

if (f.size > maxSize) {
        toast.error(`${at.fileTooLarge || "الملف كبير جداً (الحد 10 MB)"}: ${f.name}`);
        return false;
      }
      return true;
    });

    const newEntries: FileEntry[] = valid.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending",
      progress: 0,
    }));

    setFileEntries(prev => [...prev, ...newEntries]);

    // Start uploading each file
    newEntries.forEach(entry => uploadFile(entry));
  }, [at, uploadFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeEntry = (id: string) => {
    setFileEntries(prev => {
      const removed = prev.find(e => e.id === id);
      const newList = prev.filter(e => e.id !== id);
      if (removed?.url && removed.url === form.beforePhotoUrl) {
        const next = newList.find(e => e.file.type.startsWith("image/") && e.url);
        setForm(f => ({ ...f, beforePhotoUrl: next?.url || "" }));
      }
      return newList;
    });
  };

  const retryEntry = (entry: FileEntry) => {
    setFileEntries(prev =>
      prev.map(e => e.id === entry.id ? { ...e, status: "pending", progress: 0, error: undefined } : e)
    );
    uploadFile({ ...entry, status: "pending", progress: 0, error: undefined });
  };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error(t.tickets.ticketTitle); return; }
    const uploading = fileEntries.some(e => e.status === "uploading" || e.status === "pending");
    if (uploading) { toast.error(at.uploading || "الرجاء انتظار اكتمال رفع الملفات"); return; }
    // Read beforePhotoUrl directly from fileEntries to avoid stale React state closure
    const freshBeforePhotoUrl = fileEntries.find(e => e.status === "done" && e.url && e.file.type.startsWith("image/"))?.url || "";
    createMut.mutate({ ...form, beforePhotoUrl: freshBeforePhotoUrl, siteId: form.siteId ? parseInt(form.siteId) : undefined, sectionId: form.sectionId ? parseInt(form.sectionId) : undefined, assetId: form.assetId ? parseInt(form.assetId) : undefined });
  };

  const isImage = (type: string) => type.startsWith("image/");
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const doneCount = fileEntries.filter(e => e.status === "done").length;
  const uploadingCount = fileEntries.filter(e => e.status === "uploading" || e.status === "pending").length;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/tickets")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <h1 className="text-xl font-bold">{t.tickets.createNew}</h1>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label>{t.tickets.ticketTitle} *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>{t.tickets.description}</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
          </div>

          {/* Priority + Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t.tickets.priority}</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(t.priority).map(k => <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.tickets.category}</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(t.category).map(k => <SelectItem key={k} value={k}>{getCategoryLabel(k)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Site + Asset */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t.tickets.site}</Label>
              <Select value={form.siteId} onValueChange={v => setForm(f => ({ ...f, siteId: v, sectionId: "" }))}>
                <SelectTrigger><SelectValue placeholder={t.tickets.site} /></SelectTrigger>
                <SelectContent>
                  {sites?.map(s => <SelectItem key={s.id} value={String(s.id)}>{getLocalizedName(s, language)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.assets.title || "الأصل"}</Label>
              <Select value={form.assetId} onValueChange={v => setForm(f => ({ ...f, assetId: v }))}>
                <SelectTrigger><SelectValue placeholder={t.assets.title} /></SelectTrigger>
                <SelectContent>
                  {assets?.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section */}
          {form.siteId && (
            <div className="space-y-2">
              <Label>القسم</Label>
              <Select value={form.sectionId || "none"} onValueChange={v => setForm(f => ({ ...f, sectionId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="اختر القسم (اختياري)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون قسم</SelectItem>
                  {(sections || []).map(s => <SelectItem key={s.id} value={String(s.id)}>{getLocalizedName(s, language)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Location Detail */}
          <div className="space-y-2">
            <Label>{"أخرى"}</Label>
            <Input value={form.locationDetail} onChange={e => setForm(f => ({ ...f, locationDetail: e.target.value }))} />
          </div>

          {/* ───── Attachments Section ───── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{at.title || "المرفقات"}</Label>
              {fileEntries.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {doneCount}/{fileEntries.length} {at.uploaded || "مرفوع"}
                </span>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/mp4,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={handleFileInput}
              className="hidden"
              multiple
            />

            {/* Drag & Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 select-none",
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.01]"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
              )}
            >
              <div className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center transition-colors",
                isDragging ? "bg-primary/20" : "bg-muted"
              )}>
                <CloudUpload className={cn(
                  "w-7 h-7 transition-colors",
                  isDragging ? "text-primary" : "text-muted-foreground"
                )} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm">
                  {isDragging
                    ? (at.dropHere || "أفلت الملفات هنا")
                    : (at.dragDrop || "اسحب وأفلت الملفات هنا، أو اضغط للاختيار")
                  }
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {at.supportedFormats || "صور (JPG, PNG, GIF) · PDF · Word · Excel"} · {at.maxSize || "الحد الأقصى 10 MB"}
                </p>
              </div>
              {uploadingCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-primary animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {at.uploading || "جاري الرفع..."} ({uploadingCount})
                </div>
              )}
            </div>

            {/* File List with Progress */}
            {fileEntries.length > 0 && (
              <div className="space-y-2 mt-2">
                {fileEntries.map(entry => (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-lg border overflow-hidden transition-all",
                      entry.status === "error" ? "border-destructive/50 bg-destructive/5" : "border-border bg-card"
                    )}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {/* Thumbnail or icon */}
                      <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 bg-muted flex items-center justify-center">
                        {isImage(entry.file.type) && entry.url ? (
                          <img src={entry.url} alt={entry.file.name} className="w-full h-full object-cover" />
                        ) : isImage(entry.file.type) && entry.status !== "error" ? (
                          <div className="w-full h-full bg-muted animate-pulse" />
                        ) : (
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{entry.file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(entry.file.size)}</p>
                        {/* Progress bar */}
                        {(entry.status === "uploading" || entry.status === "pending") && (
                          <div className="mt-1.5">
                            <Progress value={entry.progress} className="h-1.5" />
                          </div>
                        )}
                        {entry.status === "error" && (
                          <p className="text-xs text-destructive mt-0.5">{entry.error || "فشل الرفع"}</p>
                        )}
                      </div>

                      {/* Status icon */}
                      <div className="shrink-0 flex items-center gap-1">
                        {entry.status === "uploading" || entry.status === "pending" ? (
                          <span className="text-xs text-muted-foreground">{entry.progress}%</span>
                        ) : entry.status === "done" ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : entry.status === "error" ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); retryEntry(entry); }}
                            className="text-xs text-primary underline"
                          >
                            {at.retry || "إعادة"}
                          </button>
                        ) : null}

                        {/* Remove button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); removeEntry(entry.id); }}
                          className="ml-1 p-1 rounded hover:bg-muted transition-colors"
                        >
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>

                    {/* Full-width progress bar at bottom for uploading */}
                    {entry.status === "uploading" && (
                      <div className="h-0.5 bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${entry.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Error summary */}
            {fileEntries.some(e => e.status === "error") && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{at.someFilesFailed || "بعض الملفات فشل رفعها. يمكنك إعادة المحاولة أو حذفها."}</span>
              </div>
            )}
          </div>

          {/* Submit */}
          <Button onClick={handleSubmit} disabled={createMut.isPending || uploadingCount > 0} className="w-full" size="lg">
            {createMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin ml-2" />
              : uploadingCount > 0
              ? <Loader2 className="w-4 h-4 animate-spin ml-2" />
              : null}
            {uploadingCount > 0
              ? (at.uploading || "جاري الرفع...")
              : t.tickets.createNew}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
