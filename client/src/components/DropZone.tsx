/**
 * DropZone - Reusable Drag & Drop file upload component
 * Additive layer: does NOT replace existing upload logic, only adds D&D capability
 */
import { useRef, useState, useCallback } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, RotateCcw, X, FileText, Image, Camera, ScanLine, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type UploadedFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  url?: string;
  fileKey?: string; // ✅ المفتاح النظيف من السيرفر — يُستخدم للقراءة المباشرة من S3/iDrive
  error?: string;
};

type DropZoneProps = {
  onFilesUploaded: (files: UploadedFile[]) => void;
  accept?: string; // e.g. "image/*,application/pdf"
  maxSizeMB?: number;
  maxFiles?: number;
  uploadUrl?: string;
  label?: string;
  sublabel?: string;
  className?: string;
  disabled?: boolean;
  enableCamera?: boolean; // إظهار زر "التقاط صورة" بجانب زر "رفع من الجهاز"
  enableScanner?: boolean; // إظهار زر "مسح ضوئي من الطابعة" (يحتاج تشغيل خدمة السكانر المحلية على الجهاز)
};

const SCANNER_HELPER_URL = "http://localhost:5588";
const SCANNER_HELPER_DOWNLOAD_URL = "/downloads/scanner-helper.zip";

const DEFAULT_ACCEPT = "image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_MAX_MB = 10;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <Image className="w-4 h-4 text-blue-500" />;
  return <FileText className="w-4 h-4 text-amber-500" />;
}

export default function DropZone({
  onFilesUploaded,
  accept = DEFAULT_ACCEPT,
  maxSizeMB = DEFAULT_MAX_MB,
  maxFiles = 10,
  uploadUrl = "/api/upload",
  label,
  sublabel,
  className,
  disabled = false,
  enableCamera = false,
  enableScanner = false,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannerNotInstalled, setScannerNotInstalled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (fileEntry: UploadedFile) => {
    setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: "uploading", progress: 0 } : f));

    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", fileEntry.file);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, progress: pct } : f));
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            setFiles(prev => {
              const updated = prev.map(f =>
                f.id === fileEntry.id
                  ? { ...f, status: "done" as const, progress: 100, url: data.url, fileKey: data.fileKey }
                  : f
              );
              // Notify parent with all done files
              const doneFiles = updated.filter(f => f.status === "done");
              onFilesUploaded(doneFiles);
              return updated;
            });
          } catch {
            setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: "error", error: "Parse error" } : f));
          }
        } else {
          setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: "error", error: `HTTP ${xhr.status}` } : f));
        }
        resolve();
      };

      xhr.onerror = () => {
        setFiles(prev => prev.map(f => f.id === fileEntry.id ? { ...f, status: "error", error: "Network error" } : f));
        resolve();
      };

      xhr.open("POST", uploadUrl);
      xhr.send(formData);
    });
  }, [uploadUrl, onFilesUploaded]);

  const processFiles = useCallback(async (rawFiles: File[]) => {
    if (disabled) return;
    const maxMB = maxSizeMB * 1024 * 1024;
    const toAdd: UploadedFile[] = [];
    const skippedReasons: string[] = [];

    for (const file of rawFiles.slice(0, maxFiles)) {
      if (file.size > maxMB) {
        skippedReasons.push(`"${file.name}" حجمه ${(file.size / (1024 * 1024)).toFixed(1)}MB — أكبر من الحد المسموح (${maxSizeMB}MB)`);
        continue;
      }
      if (file.size === 0) {
        skippedReasons.push(`"${file.name}" وصل فارغًا (0 بايت) — أعد المحاولة`);
        continue;
      }
      const entry: UploadedFile = {
        id: `${Date.now()}-${Math.random()}`,
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        progress: 0,
        status: "pending",
      };
      toAdd.push(entry);
    }

    if (skippedReasons.length > 0) {
      setScanError(skippedReasons.join(" — "));
      setScannerNotInstalled(false);
    }

    if (toAdd.length === 0) return;
    setFiles(prev => [...prev, ...toAdd]);

    // Upload sequentially
    for (const entry of toAdd) {
      await uploadFile(entry);
    }
  }, [disabled, maxFiles, maxSizeMB, uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    processFiles(dropped);
  }, [processFiles]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  // ── مسح ضوئي من الطابعة عبر خدمة السكانر المحلية (scanner-helper) ──
  // تشتغل فقط لو الخدمة شغّالة على نفس جهاز المستخدم على http://localhost:5588
  const handleScan = async () => {
    if (disabled || isScanning) return;
    setScanError(null);
    setScannerNotInstalled(false);
    setIsScanning(true);
    try {
      // تايم آوت يدوي (بدل AbortSignal.timeout غير المدعومة في كل المتصفحات)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let healthRes: Response;
      try {
        healthRes = await fetch(`${SCANNER_HELPER_URL}/health`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!healthRes.ok) throw new Error(`الخدمة ردّت لكن بحالة غير سليمة (HTTP ${healthRes.status})`);
    } catch (err: any) {
      setIsScanning(false);
      setScannerNotInstalled(true);
      // نعرض تفاصيل الخطأ الحقيقي (مش رسالة عامة) عشان يسهل تشخيصه
      const detail = err?.name === "AbortError" ? "انتهت المهلة قبل ما الخدمة تردّ" : (err?.message || String(err));
      setScanError(`خدمة السكانر المحلية مش شغّالة على جهازك. (${detail})`);
      return;
    }

    try {
      const scanRes = await fetch(`${SCANNER_HELPER_URL}/scan`, { method: "POST" });
      if (!scanRes.ok) {
        const errData = await scanRes.json().catch(() => null);
        throw new Error(errData?.error || "فشل المسح الضوئي");
      }
      const blob = await scanRes.blob();
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
      await processFiles([file]);
    } catch (err: any) {
      setScanError(err?.message || "تعذر إتمام المسح الضوئي");
    } finally {
      setIsScanning(false);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      onFilesUploaded(updated.filter(f => f.status === "done"));
      return updated;
    });
  };

  const retryFile = (entry: UploadedFile) => {
    setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: "pending", progress: 0, error: undefined } : f));
    uploadFile({ ...entry, status: "pending", progress: 0 });
  };

  const hasFiles = files.length > 0;
  const isUploading = files.some(f => f.status === "uploading");

  return (
    <div className={cn("space-y-3", className)}>
      {/* منطقة الرفع / الالتقاط */}
      {(enableCamera || enableScanner) ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "relative border-2 border-dashed rounded-xl p-4 transition-all duration-200",
            isDragging
              ? "border-primary bg-primary/10 scale-[1.01] shadow-md"
              : "border-muted-foreground/30",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={handleInputChange}
            disabled={disabled}
          />
          {enableCamera && (
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleInputChange}
              disabled={disabled}
            />
          )}

          {isUploading || isScanning ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm font-medium">{isScanning ? "جاري المسح الضوئي..." : "جاري الرفع..."}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-center text-muted-foreground">
                {isDragging ? "أفلت الملفات هنا" : (sublabel || label || "اختر طريقة الإضافة")}
              </p>
              <div className={cn("grid gap-2.5", enableCamera && enableScanner ? "grid-cols-3" : "grid-cols-2")}>
                <button
                  type="button"
                  onClick={() => !disabled && inputRef.current?.click()}
                  disabled={disabled}
                  className={cn(
                    "flex flex-col items-center gap-1.5 py-4 px-2 rounded-lg border-2 border-dashed transition-all select-none",
                    "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30",
                    disabled && "cursor-not-allowed"
                  )}
                >
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <span className="text-xs font-medium">رفع من الجهاز</span>
                </button>
                {enableCamera && (
                  <button
                    type="button"
                    onClick={() => !disabled && cameraInputRef.current?.click()}
                    disabled={disabled}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-4 px-2 rounded-lg border-2 border-dashed transition-all select-none",
                      "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30",
                      disabled && "cursor-not-allowed"
                    )}
                  >
                    <Camera className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs font-medium">التقاط صورة</span>
                  </button>
                )}
                {enableScanner && (
                  <button
                    type="button"
                    onClick={handleScan}
                    disabled={disabled}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-4 px-2 rounded-lg border-2 border-dashed transition-all select-none",
                      "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30",
                      disabled && "cursor-not-allowed"
                    )}
                  >
                    <ScanLine className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs font-medium">مسح ضوئي من الطابعة</span>
                  </button>
                )}
              </div>

              {/* رسالة الخطأ العادية (مثلاً فشل مسح فعلي بعد ما الخدمة كانت شغّالة) */}
              {scanError && !scannerNotInstalled && (
                <p className="text-xs text-destructive text-center bg-destructive/10 rounded-md py-1.5 px-2">{scanError}</p>
              )}

              {/* حالة خاصة: الخدمة المحلية مش مثبّتة/شغّالة — نعرض رابط تحميل مباشر بدل رسالة خطأ عادية */}
              {scannerNotInstalled && (
                <div className="text-center bg-amber-50 border border-amber-200 rounded-md py-2.5 px-3 space-y-1.5">
                  <p className="text-xs text-amber-800">
                    محتاج تشغّل "خدمة السكانر المحلية" على جهازك الأول (مرة واحدة بس).
                  </p>
                  {scanError && (
                    <p className="text-[11px] text-amber-600 font-mono bg-amber-100/60 rounded px-2 py-1 break-all">{scanError}</p>
                  )}
                  <a
                    href={SCANNER_HELPER_DOWNLOAD_URL}
                    download
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 transition-colors rounded-md px-3 py-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    تحميل برنامج السكانر المساعد
                  </a>
                  <p className="text-[11px] text-amber-700">
                    بعد التحميل: فُك ضغط الملف، ثم دبل-كليك على <code className="font-mono">start.bat</code> جوه المجلد وسيبه شغّال، وارجع اضغط الزر تاني.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && inputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 select-none",
            isDragging
              ? "border-primary bg-primary/10 scale-[1.01] shadow-md"
              : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={handleInputChange}
            disabled={disabled}
          />

          <div className={cn(
            "flex flex-col items-center gap-2 transition-transform duration-200",
            isDragging && "scale-105"
          )}>
            {isUploading ? (
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            ) : (
              <Upload className={cn("w-8 h-8 transition-colors", isDragging ? "text-primary" : "text-muted-foreground")} />
            )}
            <div>
              <p className={cn("text-sm font-medium transition-colors", isDragging ? "text-primary" : "text-foreground")}>
                {isDragging ? "أفلت الملفات هنا" : (label || "اسحب وأفلت الملفات هنا")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sublabel || `أو انقر للاختيار — الحد الأقصى ${maxSizeMB} MB لكل ملف`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File List */}
      {hasFiles && (
        <div className="space-y-2">
          {files.map(f => (
            <div key={f.id} className={cn(
              "flex items-center gap-3 p-3 rounded-lg border text-sm transition-colors",
              f.status === "done" && "border-green-200 bg-green-50/50",
              f.status === "error" && "border-red-200 bg-red-50/50",
              f.status === "uploading" && "border-blue-200 bg-blue-50/50",
              f.status === "pending" && "border-muted bg-muted/30"
            )}>
              {/* Icon */}
              <div className="shrink-0">{getFileIcon(f.mimeType)}</div>

              {/* Name + Progress */}
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-xs">{f.name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>

                {/* Progress Bar */}
                {(f.status === "uploading" || f.status === "done") && (
                  <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        f.status === "done" ? "bg-green-500" : "bg-primary"
                      )}
                      style={{ width: `${f.progress}%` }}
                    />
                  </div>
                )}

                {f.status === "error" && (
                  <p className="text-xs text-red-500 mt-0.5">{f.error || "فشل الرفع"}</p>
                )}
              </div>

              {/* Status Icon */}
              <div className="shrink-0 flex items-center gap-1">
                {f.status === "uploading" && (
                  <span className="text-xs text-blue-600 font-medium">{f.progress}%</span>
                )}
                {f.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {f.status === "error" && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); retryFile(f); }}>
                    <RotateCcw className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}>
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
