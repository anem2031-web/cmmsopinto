import "dotenv/config";
import { env } from "./config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers/index";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import IORedis from "ioredis";
import multer from "multer";
import { storagePut, storageGetStream, storagePresignedPut } from "../storage";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { exportTicketsToExcel, exportPurchaseOrdersToExcel, exportTechnicianPerformanceToExcel, exportAuditLogToExcel, exportInventoryToExcel, exportPreventivePlansToExcel, exportPMWorkOrdersToExcel, generateDelegateItemsPDF, generatePurchaseRequestPDF } from "../exportService";
import { generateWorkflowGuidePDF } from "../workflowPdfService";
import { runTechnicianOverdueJob } from "../jobs/technician-overdue";
import { runPMAutomationJob } from "../jobs/pm-automation";
import { runPMWorkOrderReminderJob } from "../jobs/pm-reminder";
import { runSlaOverduePushJob } from "../jobs/sla-overdue-push";
import { runBackupCleanupJob } from "../jobs/backup-cleanup";
import { runConstructionAutomation } from "../jobs/construction-automation";
import { getDb } from "../db";
import { generatePMWorkOrderPDF } from "../pmWorkOrderPdfService";
import { generateTicketPDF } from "../ticketPdfService";
import { sdk } from "./sdk";

// ============================================================
// AUTH MIDDLEWARE — C-01 & C-02 FIX
// Restricts access to export/upload endpoints to authenticated users only
// Allowed roles: owner, admin, maintenance_manager, supervisor, senior_management, accounting
// ============================================================
const EXPORT_ALLOWED_ROLES = new Set([
  "owner", "admin", "maintenance_manager", "supervisor", "senior_management", "accounting"
]);

async function requireAuthMiddleware(req: any, res: any, next: any) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
    }
    req.authenticatedUser = user;
    next();
  } catch {
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
}

async function requireExportRole(req: any, res: any, next: any) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
    }
    if (!EXPORT_ALLOWED_ROLES.has(user.role)) {
      return res.status(403).json({ error: "ليس لديك صلاحية تصدير البيانات" });
    }
    req.authenticatedUser = user;
    next();
  } catch {
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const server = createServer(app);

  // ============================================================
  // H-02 FIX: تفعيل Content Security Policy في Helmet
  // ============================================================
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // unsafe-eval removed (high risk, not needed for production build)
        // unsafe-inline kept: required for Vite HMR in dev and inline event handlers in built bundle
        scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ============================================================
  // M-01 FIX: Rate Limiting محسّن يشمل /api/trpc
  // Redis store إذا كان REDIS_URL متاحاً، وإلا in-memory fallback
  // ============================================================
  let redisStoreForApi: RedisStore | undefined;
  let redisStoreForAuth: RedisStore | undefined;
  if (env.REDIS_URL) {
    try {
      const redisClient = new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      await redisClient.connect().catch((connectErr) => { console.warn("[RateLimit] Redis connection failed:", (connectErr as Error).message); });
      if (redisClient.status === "ready") {
        redisStoreForApi = new RedisStore({
          // @ts-expect-error - Known issue: the `call` function is not present in @types/ioredis
          sendCommand: (...args: string[]) => redisClient.call(...args),
          prefix: "rl:api:",
        });
        redisStoreForAuth = new RedisStore({
          // @ts-expect-error - Known issue: the `call` function is not present in @types/ioredis
          sendCommand: (...args: string[]) => redisClient.call(...args),
          prefix: "rl:auth:",
        });
        console.log("[RateLimit] Redis store active");
      } else {
        console.warn("[RateLimit] Redis not ready, falling back to in-memory store");
      }
    } catch (err) {
      console.warn("[RateLimit] Redis init failed, falling back to in-memory store:", (err as Error).message);
    }
  } else {
    console.warn("[RateLimit] REDIS_URL not set, using in-memory store (not suitable for multi-instance)");
  }

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''),
    message: { error: "تم تجاوز الحد الأقصى للطلبات. يرجى المحاولة لاحقاً" },
    ...(redisStoreForApi ? { store: redisStoreForApi } : {}),
  });

  // Rate limiter أكثر صرامة للـ auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''),
    message: { error: "تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول. يرجى المحاولة بعد 15 دقيقة" },
    ...(redisStoreForAuth ? { store: redisStoreForAuth } : {}),
  });

  // ============================================================
  // HEALTH CHECK — registered BEFORE rate limiter and all other middleware
  // Using /api/health so it bypasses Fastly CDN static-file interception
  // (Fastly only intercepts non-/api/* paths as SPA fallback)
  // No authentication required (used by Railway health checks)
  // ============================================================
  app.get("/api/health", async (_req: any, res: any) => {
    // Prevent CDN (Fastly/Railway) from caching this endpoint
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Surrogate-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const timestamp = new Date().toISOString();
    const uptime = Math.floor(process.uptime());
    try {
      const db = await getDb();
      if (db) {
        await db.execute("SELECT 1" as any);
        return res.status(200).json({ status: "ok", timestamp, database: "connected", uptime });
      } else {
        return res.status(503).json({ status: "degraded", timestamp, database: "disconnected", uptime });
      }
    } catch {
      return res.status(503).json({ status: "degraded", timestamp, database: "disconnected", uptime });
    }
  });

  app.use("/api/", apiLimiter);
  app.use("/api/oauth/", authLimiter);

  // ============================================================
  // H-03 FIX: تقليل Body Parser limit إلى 1MB لمنع هجمات DoS
  // (رفع الملفات يمر عبر multer وليس body parser)
  // ============================================================
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // ============================================================
  // C-02 FIX: تأمين Upload endpoint بمصادقة إلزامية
  // ============================================================
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 16 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      // L-02 FIX: التحقق من نوع الملف بالـ mimetype
      const ALLOWED_MIME_TYPES = new Set([
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]);
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`نوع الملف غير مسموح: ${file.mimetype}`));
      }
    },
  });

  // MEDIA PROXY: serves images from iDrive e2 through the server
  // ============================================================
  // Media proxy is intentionally public to allow <img> tags to load images
  // without sending session cookies. Security is enforced by restricting
  // access to the cmms/ key prefix only.
  app.get("/api/media", async (req: any, res: any) => {
    try {
      const key = req.query.key as string;
      // Reject empty or missing keys
      if (!key || typeof key !== "string" || key.trim() === "") {
        return res.status(400).json({ error: "Missing or invalid key" });
      }
      // Reject path traversal attempts (encoded and plain)
      if (key.includes("..") || key.toLowerCase().includes("%2e%2e")) {
        return res.status(400).json({ error: "Invalid key" });
      }
      // Only allow keys under the cmms/ namespace to prevent arbitrary file access
      const normalizedKey = key.replace(/^\/+/, "");
      if (!normalizedKey.startsWith("cmms/")) {
        return res.status(400).json({ error: "Invalid key" });
      }
      const { stream, contentType } = await storageGetStream(normalizedKey);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=86400");
      // إذا طُلب التنزيل، أضف Content-Disposition
      if (req.query.download === "1") {
        const filename = req.query.filename as string || normalizedKey.split("/").pop() || "file";
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      (stream as any).pipe(res);
    } catch (error: any) {
      console.error("Media proxy error:", error);
      res.status(404).json({ error: "Media not found" });
    }
  });

  // ── Presigned Upload URL ─────────────────────────────────────────────────
  // المتصفح يطلب رابط مؤقت ثم يرفع الصورة مباشرة لـ S3 بدون المرور بالسيرفر
  app.post("/api/upload-url", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const { contentType } = req.body;
      const ALLOWED = new Set([
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "image/heic", "image/heif", "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]);
      const mime = ALLOWED.has(contentType) ? contentType : "image/jpeg";
      const ext  = mime === "image/jpeg" ? "jpg"
                 : mime === "image/png"  ? "png"
                 : mime === "image/webp" ? "webp"
                 : mime === "application/pdf" ? "pdf" : "jpg";
      const fileKey = `cmms/uploads/${Date.now()}-${nanoid(8)}.${ext}`;
      const { uploadUrl, proxyUrl } = await storagePresignedPut(fileKey, mime);
      res.json({ uploadUrl, proxyUrl, fileKey });
    } catch (e: any) {
      console.error("[Presigned URL] Error:", e.message);
      res.status(500).json({ error: "فشل إنشاء رابط الرفع" });
    }
  });

  app.post("/api/upload", requireAuthMiddleware, upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const isImage = req.file.mimetype.startsWith("image/");
      let fileBuffer = req.file.buffer;
      let mimeType = req.file.mimetype;
      let ext = req.file.originalname.split(".").pop() || "bin";

      // تحويل الصور إلى WebP مع تقليص الأبعاد لتسريع الرفع
      if (isImage) {
        fileBuffer = await sharp(req.file.buffer)
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75, effort: 2 })
          .toBuffer();
        mimeType = "image/webp";
        ext = "webp";
      }
      const fileKey = `cmms/uploads/${Date.now()}-${nanoid(8)}.${ext}`;
      await storagePut(fileKey, fileBuffer, mimeType);
      // Always return proxy URL so images load reliably regardless of bucket ACL or CORS
      const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;
      res.json({ url: proxyUrl, fileKey });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // ============================================================
  // C-01 FIX: تأمين جميع Export endpoints بمصادقة + صلاحية
  // ============================================================
  app.get("/api/export/tickets", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportTicketsToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=tickets-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/purchase-orders", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportPurchaseOrdersToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=purchase-orders-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/technician-performance", requireExportRole, async (req: any, res: any) => {
    try {
      const filters: any = {};
      if (req.query.dateFrom) filters.dateFrom = new Date(req.query.dateFrom);
      if (req.query.dateTo) { const d = new Date(req.query.dateTo); d.setHours(23, 59, 59, 999); filters.dateTo = d; }
      const buffer = await exportTechnicianPerformanceToExcel(Object.keys(filters).length ? filters : undefined);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=technician-performance-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/audit-log", requireExportRole, async (req: any, res: any) => {
    try {
      const filters: any = {};
      if (req.query.entityType) filters.entityType = req.query.entityType;
      if (req.query.action) filters.action = req.query.action;
      if (req.query.dateFrom) filters.dateFrom = new Date(req.query.dateFrom);
      if (req.query.dateTo) { const d = new Date(req.query.dateTo); d.setHours(23, 59, 59, 999); filters.dateTo = d; }
      const buffer = await exportAuditLogToExcel(Object.keys(filters).length ? filters : undefined);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=audit-log-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/inventory", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportInventoryToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=inventory-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/preventive-plans", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportPreventivePlansToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=preventive-plans-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/pm-work-orders", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportPMWorkOrdersToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=pm-work-orders-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/workflow-guide", requireExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await generateWorkflowGuidePDF();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=CMMS-Workflow-Guide-${new Date().toISOString().slice(0, 10)}.pdf`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PDF لأمر العمل الوقائي
  app.get("/api/export/pm-work-order/:id", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "رقم غير صحيح" });
      const buffer = await generatePMWorkOrderPDF(id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=work-order-${id}-${Date.now()}.pdf`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Delegate purchasing items — PDF export (auth only, no role restriction)
  app.get("/api/export/my-items-pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const user = req.authenticatedUser;
      const buffer = await generateDelegateItemsPDF(user.id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=my-items-${Date.now()}.pdf`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Ticket PDF report — isolated Puppeteer-based PDF generation (auth required)
  app.get("/api/tickets/:id/pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) return res.status(400).json({ error: "رقم البلاغ غير صحيح" });
      const buffer = await generateTicketPDF(ticketId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=ticket-${ticketId}-${Date.now()}.pdf`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Purchase Request PDF export — delegate pricing workflow (auth required)
  app.get("/api/export/po/:id/pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id);
      if (isNaN(poId)) return res.status(400).json({ error: "Invalid purchase request ID" });
      const batchIdRaw = req.query.batchId;
      const batchId = batchIdRaw ? parseInt(batchIdRaw as string) : undefined;
      const user = req.authenticatedUser;
      const buffer = await generatePurchaseRequestPDF(poId, user.id, batchId);
      const { getPurchaseOrderById } = await import("../db");
      const po = await getPurchaseOrderById(poId);
      const filename = po?.poNumber
        ? (batchId ? `${po.poNumber}-batch${batchId}.pdf` : `${po.poNumber}.pdf`)
        : `po-${poId}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.send(buffer);
} catch (e: any) { console.error("[PDF Export Error]", e.message); res.status(500).json({ error: e.message }); }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // استعادة الـ translation jobs المعلقة عند بدء التشغيل
  setTimeout(async () => {
    try {
      const { recoverPendingTranslations } = await import("../translationEngine");
      await recoverPendingTranslations();
    } catch (e) {
      console.error("[Startup] Translation recovery failed:", e);
    }
  }, 3000);

  const ONE_HOUR = 60 * 60 * 1000;
  setTimeout(() => {
    runTechnicianOverdueJob();
    setInterval(runTechnicianOverdueJob, ONE_HOUR);
  }, 5000);

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setTimeout(() => {
    runPMAutomationJob();
    setInterval(runPMAutomationJob, SIX_HOURS);
  }, 10000);

  // PM Reminder Job: يفحص كل ساعتين أوامر العمل التي تجاوزت 24 ساعة بدون تحديث
   const TWO_HOURS = 2 * 60 * 60 * 1000;
  setTimeout(() => {
    runPMWorkOrderReminderJob();
    setInterval(runPMWorkOrderReminderJob, TWO_HOURS);
  }, 15000);

  // SLA Overdue Push - كل 6 ساعات
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setTimeout(() => {
    runSlaOverduePushJob();
    setInterval(runSlaOverduePushJob, SIX_HOURS_MS);
  }, 20000);

  // Backup Cleanup Job: runs daily, deletes backups older than 30 days
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    runBackupCleanupJob();
    setInterval(runBackupCleanupJob, ONE_DAY_MS);
  }, 25000);

  // Construction Automation Engine: runs every 5 minutes
  const FIVE_MINUTES = 5 * 60 * 1000;
  setTimeout(() => {
    runConstructionAutomation();
    setInterval(runConstructionAutomation, FIVE_MINUTES);
  }, 30000);

  // ============================================================
  // GLOBAL EXPRESS ERROR HANDLER (TASK 3)
  // Logs structured error info for every unhandled Express error
  // ============================================================
  app.use((err: any, req: any, res: any, _next: any) => {
    const ts = new Date().toISOString();
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[ERROR] ${ts} ${req.method} ${req.path} ${status} ${message}`);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });
}

// ============================================================
// PROCESS-LEVEL ERROR HANDLERS (TASK 3)
// Railway auto-restarts on exit — crashing fast is safer than
// staying alive in a corrupted state.
// ============================================================
process.on("uncaughtException", (err: Error) => {
  const ts = new Date().toISOString();
  console.error(`[UNCAUGHT_EXCEPTION] ${ts} ${err.stack || err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const ts = new Date().toISOString();
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`[UNHANDLED_REJECTION] ${ts} ${msg}`);
  process.exit(1);
});

startServer().catch(console.error);
