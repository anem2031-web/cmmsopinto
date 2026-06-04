/**
 * useOfflineUpload
 * ================
 * يضغط الصورة في المتصفح (Canvas API) ثم:
 *   - إذا كان الإنترنت متاحاً  → يرفعها مباشرة
 *   - إذا كان الإنترنت مقطوعاً → يحفظها في IndexedDB ويرفعها تلقائياً عند عودة الاتصال
 *
 * الاستخدام:
 *   const { uploadImage, isOnline, pendingCount } = useOfflineUpload();
 *   const url = await uploadImage(file);  // يُرجع URL أو null إذا حُفظ offline
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
const DB_NAME = "cmms_offline_uploads";
const DB_VERSION = 1;
const STORE_NAME = "pending_uploads";

interface PendingUpload {
  id: string;
  blob: Blob;
  mimeType: string;
  field: string;          // "invoice" | "purchased" | "after_photo" | etc.
  itemId?: number;
  createdAt: number;
  retries: number;
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePending(item: PendingUpload): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllPending(): Promise<PendingUpload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as PendingUpload[]);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Image compression (Canvas API) ──────────────────────────────────────────
/**
 * يضغط الصورة في المتصفح قبل الإرسال
 * الهدف: تقليل الحجم من 5-15 MB إلى 150-400 KB
 * @param file    الملف الأصلي
 * @param maxPx   الحد الأقصى للبُعد الأكبر (افتراضي: 1200px)
 * @param quality جودة JPEG (0-1، افتراضي: 0.78)
 */
export async function compressImage(
  file: File,
  maxPx = 1200,
  quality = 0.78
): Promise<Blob> {
  // Android أحياناً يُرجع type فارغ — نتحقق من الامتداد أيضاً
  const imageExts = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;
  const isImage =
    file.type.startsWith("image/") ||
    (file.type === "" && imageExts.test(file.name)) ||
    (file.type === "application/octet-stream" && imageExts.test(file.name));

  if (!isImage) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // احسب الأبعاد الجديدة مع الحفاظ على النسبة
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) {
          height = Math.round((height / width) * maxPx);
          width = maxPx;
        } else {
          width = Math.round((width / height) * maxPx);
          height = maxPx;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fallback: أرجع الملف الأصلي
    };

    img.src = objectUrl;
  });
}

// ─── رفع ملف مباشرة لـ S3 عبر Presigned URL ─────────────────────────────────
async function uploadToServer(blob: Blob, mimeType: string): Promise<string | null> {

  // الخطوة 1: طلب Presigned URL من السيرفر (طلب خفيف جداً)
  const urlRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ contentType: mimeType }),
  });

  if (!urlRes.ok) {
    // fallback: لو فشل الـ presigned، ارفع بالطريقة القديمة
    return uploadToServerFallback(blob, mimeType);
  }

  const { uploadUrl, proxyUrl } = await urlRes.json();

  // الخطوة 2: رفع الصورة مباشرة لـ S3 بدون المرور بالسيرفر
  const s3Res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: blob,
  });

  if (!s3Res.ok) return uploadToServerFallback(blob, mimeType);

  return proxyUrl;
}

// fallback: الطريقة القديمة لو فشل الـ Presigned URL
async function uploadToServerFallback(blob: Blob, mimeType: string): Promise<string | null> {
  const formData = new FormData();
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "bin";
  formData.append("file", new File([blob], `photo.${ext}`, { type: mimeType }));

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.url ?? null;
}

// ─── Hook الرئيسي ─────────────────────────────────────────────────────────────
export interface OfflineUploadResult {
  /** true = رُفع مباشرة وأُرجع URL، false = حُفظ offline */
  uploaded: boolean;
  /** URL إذا رُفع مباشرة، null إذا حُفظ للمزامنة لاحقاً */
  url: string | null;
}

export function useOfflineUpload() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncLockRef = useRef(false);

  // ── تحديث حالة الاتصال ──────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPending(); // ابدأ المزامنة فور عودة الاتصال
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // حمّل عدد الصور المعلقة عند فتح الصفحة
    getPendingCount().then(setPendingCount).catch(() => {});

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── مزامنة الصور المعلقة مع السيرفر ─────────────────────────────────────
  const syncPending = useCallback(async () => {
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setIsSyncing(true);

    try {
      const pending = await getAllPending();
      if (pending.length === 0) return;

      for (const item of pending) {
        try {
          const url = await uploadToServer(item.blob, item.mimeType);
          if (url) {
            // أُرسل حدث للصفحة حتى تُحدّث الـ state
            window.dispatchEvent(
              new CustomEvent("cmms:upload:synced", {
                detail: { id: item.id, url, field: item.field, itemId: item.itemId },
              })
            );
            await deletePending(item.id);
          }
        } catch {
          // فشل هذا الصنف، جرّب التالي
        }
      }

      const remaining = await getPendingCount();
      setPendingCount(remaining);
    } finally {
      syncLockRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // ── الدالة الرئيسية: اضغط الصورة ثم ارفع أو احفظ ────────────────────────
  const uploadImage = useCallback(
    async (
      file: File,
      options?: { field?: string; itemId?: number }
    ): Promise<OfflineUploadResult> => {
      // 1. اضغط الصورة في المتصفح أولاً (دائماً، بغض النظر عن الإنترنت)
      const compressed = await compressImage(file);
      const mimeType = file.type.startsWith("image/") ? "image/jpeg" : file.type;

      // 2. إذا كان الإنترنت متاحاً — ارفع مباشرة
      if (navigator.onLine) {
        try {
          const url = await uploadToServer(compressed, mimeType);
          if (url) return { uploaded: true, url };
        } catch {
          // فشل الرفع المباشر — احفظ offline
        }
      }

      // 3. الإنترنت مقطوع أو فشل الرفع — احفظ في IndexedDB
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await savePending({
        id,
        blob: compressed,
        mimeType,
        field: options?.field ?? "unknown",
        itemId: options?.itemId,
        createdAt: Date.now(),
        retries: 0,
      });

      const newCount = await getPendingCount();
      setPendingCount(newCount);

      return { uploaded: false, url: null };
    },
    []
  );

  return {
    uploadImage,
    isOnline,
    pendingCount,
    isSyncing,
    syncPending,
  };
}
