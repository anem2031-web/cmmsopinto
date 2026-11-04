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
import { createHash } from "crypto";
import multer from "multer";
import { storagePut, storageGetStream, storagePresignedPut, checkStorageHealth } from "./storage";
import { nanoid } from "nanoid";
import { observerHttpAllowed } from "../../shared/observer-policy";
import { technicianHttpAllowed } from "../../shared/technician-policy";
import { businessHttpAllowed } from "../../shared/business-role-policy";
import { gateSecurityHttpAllowed } from "../../shared/gate-security-policy";
import { assertMediaAccess } from "./authz/media-access";
import { authorizePurchaseDocument } from "./authz/purchase-document";
import sharp from "sharp";
import { transcodeVideoToCompatibleMp4 } from "./videoTranscode";
import { exportTicketsToExcel, exportPurchaseOrdersToExcel, exportTechnicianPerformanceToExcel, exportAuditLogToExcel, exportInventoryToExcel, exportPreventivePlansToExcel, exportPMWorkOrdersToExcel, generateDelegateItemsPDF, generatePurchaseRequestPDF } from "../services/export/exportService";
import { inventoryBookExportFilterSchema } from "../../shared/inventory-export";
import { generateWorkflowGuidePDF } from "../services/pdf/workflowPdfService";
import { runTechnicianOverdueJob } from "../jobs/technician-overdue";
import { runPMAutomationJob } from "../jobs/pm-automation";
import { runPmv2SchedulerJob } from "../jobs/pmv2-scheduler";
import { runPMWorkOrderReminderJob } from "../jobs/pm-reminder";
import { runSlaOverduePushJob } from "../jobs/sla-overdue-push";
import { runBackupCleanupJob } from "../jobs/backup-cleanup";
import { runConstructionAutomation } from "../jobs/construction-automation";
import {
  API_RATE_LIMIT,
  SESSION_CHECK_RATE_LIMIT,
  isDedicatedSessionCheckRequest,
} from "./rate-limit-policy";
import { getDb, getTicketById } from "./db";
import { generatePMWorkOrderPDF } from "../services/pdf/pmWorkOrderPdfService";
import { generateTicketPDF, type TicketPdfDocumentType } from "../services/pdf/ticketPdfService";
import { assertTicketReadable } from "../routers/tickets/tickets.access";
import { canDownloadTicketArchive, canPrintTicketTask } from "@shared/ticketUiRules";
import { htmlToPdf } from "../services/pdf/htmlToPdfService";
import { canonicalInventoryDocument, resolveDocumentPdfInput } from "../services/pdf/canonicalDocumentExport";
import { isSessionAuthenticationError, sdk } from "./sdk";
import {
  buildReportsCenterPreviewExcel,
  buildReportsCenterPreviewPdf,
  buildReportsCenterPreviewPrintHtml,
} from "../services/reports/reportsCenterFoundationPreview";
import {
  buildInventoryStockBalanceExcel,
  buildInventoryStockBalancePdf,
  buildInventoryStockBalancePrintHtml,
  type StockBalanceFilters,
} from "../services/reports/inventoryStockBalanceReport";
import {
  buildInventoryMovementExcel,
  buildInventoryMovementPdf,
  buildInventoryMovementPrintHtml,
  type InventoryMovementFilters,
} from "../services/reports/inventoryMovementReport";
import {
  buildInventoryValuationExcel,
  buildInventoryValuationPdf,
  buildInventoryValuationPrintHtml,
  type InventoryValuationFilters,
} from "../services/reports/inventoryValuationReport";
import {
  buildInventoryValueByWarehouseExcel,
  buildInventoryValueByWarehousePdf,
  buildInventoryValueByWarehousePrintHtml,
  buildInventoryValueByCategoryExcel,
  buildInventoryValueByCategoryPdf,
  buildInventoryValueByCategoryPrintHtml,
} from "../services/reports/inventoryValueDistributionReport";
import {
  buildInventoryAccountingReviewExcel,
  buildInventoryAccountingReviewPdf,
  buildInventoryAccountingReviewPrintHtml,
  type InventoryAccountingReviewFilters,
} from "../services/reports/inventoryAccountingReviewReport";
import {
  buildInventoryAnalyticsExcel,
  buildInventoryAnalyticsPdf,
  buildInventoryAnalyticsPrintHtml,
  type InventoryAnalyticsFilters,
  type InventoryAnalyticsView,
} from "../services/reports/inventoryAnalyticsReport";

// ============================================================
// AUTH MIDDLEWARE — C-01 & C-02 FIX
// Restricts access to export/upload endpoints to authenticated users only
// Allowed roles: owner, admin, maintenance_manager, supervisor, senior_management, accounting
// ============================================================
const EXPORT_ALLOWED_ROLES = new Set([
  // ⚠️ كان مكتوبًا "accounting" (خطأ إملائي — لا يوجد دور بهذا الاسم بالنظام
  // إطلاقًا؛ الصحيح "accountant")، ما كان يعطّل صلاحية التصدير عن المحاسب
  // بصمت رغم أن النية الواضحة منحه إياها. صُحّح بتاريخ 2026-07-28.
  "owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "supervisor", "senior_management", "accountant"
]);

/**
 * تصدير الجرد تحديدًا: نفس الأدوار أعلاه + المستودع.
 * أمين المستودع يحتاج تصدير الجرد لعمله اليومي، لكن ليس بقية التصديرات
 * (بلاغات، طلبات شراء، سجل تدقيق...) — قرار صريح من صاحب المشروع 2026-07-28.
 */
const INVENTORY_EXPORT_ALLOWED_ROLES = new Set([
  "owner", "admin", "maintenance_manager", "supervisor",
  "senior_management", "accountant", "warehouse",
]);

async function requireAuthMiddleware(req: any, res: any, next: any) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
    }
    if (!observerHttpAllowed(user.role)) return res.status(403).json({ error: "دور المراقب للاستعراض فقط؛ هذا الإجراء غير مسموح" });
    if (!technicianHttpAllowed(user, req.method, req.path)) return res.status(403).json({ error: "هذا المسار خارج صلاحيات تنفيذ مهام الفني" });
    if (!businessHttpAllowed(user, req.method, req.path)) return res.status(403).json({ error: "هذا المسار خارج صلاحيات حسابك" });
    if (user.role === "gate_security" && !gateSecurityHttpAllowed(user, req.method, req.path)) return res.status(403).json({ error: "صلاحيات هذا الحساب مقتصرة على أعمال البوابة" });
    req.authenticatedUser = user;
    next();
  } catch (error) {
    if (!isSessionAuthenticationError(error)) {
      console.error("[Auth] Protected HTTP route authentication unavailable", error);
      return res.status(503).json({ error: "تعذر التحقق من الجلسة مؤقتًا" });
    }
    return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
  }
}

function makeRequireExportRole(allowedRoles: Set<string>) {
  return async function requireExportRoleMiddleware(req: any, res: any, next: any) {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
      }
      if (!allowedRoles.has(user.role)) {
        return res.status(403).json({ error: "ليس لديك صلاحية تصدير البيانات" });
      }
      if (!businessHttpAllowed(user, req.method, req.path)) return res.status(403).json({ error: "هذا المسار خارج صلاحيات حسابك" });
      req.authenticatedUser = user;
      next();
    } catch (error) {
      if (!isSessionAuthenticationError(error)) {
        console.error("[Auth] Export authentication unavailable", error);
        return res.status(503).json({ error: "تعذر التحقق من الجلسة مؤقتًا" });
      }
      return res.status(401).json({ error: "غير مصرح — يجب تسجيل الدخول أولاً" });
    }
  };
}

/** التصديرات العامة (طلبات الشراء والتقارير وغيرها). */
const requireExportRole = makeRequireExportRole(EXPORT_ALLOWED_ROLES);

/** تصدير البلاغات مستبعد من دور مدير الإنشاءات والمشتريات. */
const TICKET_EXPORT_ALLOWED_ROLES = new Set([
  "owner", "admin", "maintenance_manager", "general_maintenance_manager",
  "supervisor", "senior_management", "accountant",
]);
const requireTicketExportRole = makeRequireExportRole(TICKET_EXPORT_ALLOWED_ROLES);

/** تصدير الجرد فقط — يشمل المستودع إضافةً للأدوار العامة */
const requireInventoryExportRole = makeRequireExportRole(INVENTORY_EXPORT_ALLOWED_ROLES);
const requireOwnerAdminExportRole = makeRequireExportRole(new Set(["owner", "admin"]));

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
        connectSrc: ["'self'", "https:", "wss:", "http://localhost:5588", "http://127.0.0.1:5588"],
        mediaSrc: ["'self'", "blob:", "https:"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: false,
  }));

  // ============================================================
  // M-01 FIX: Rate Limiting محسّن يشمل /api/trpc
  // Redis store إذا كان REDIS_URL متاحاً، وإلا in-memory fallback
  // ============================================================
  let redisStoreForApi: RedisStore | undefined;
  let redisStoreForAuth: RedisStore | undefined;
  let redisStoreForSessionCheck: RedisStore | undefined;
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
        redisStoreForSessionCheck = new RedisStore({
          // @ts-expect-error - Known issue: the `call` function is not present in @types/ioredis
          sendCommand: (...args: string[]) => redisClient.call(...args),
          prefix: "rl:session-check:",
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

  const clientKeyHash = (req: express.Request) => createHash("sha256")
    .update(req.ip ?? req.socket.remoteAddress ?? "unknown")
    .digest("hex")
    .slice(0, 12);
  const rateLimitHandler = (scope: "api" | "session-check") =>
    (req: express.Request, res: express.Response) => {
      console.warn("[RateLimit] Request blocked", {
        scope,
        method: req.method,
        path: req.originalUrl.split("?", 1)[0],
        clientKey: clientKeyHash(req),
      });
      res.status(429).json({ error: "تم تجاوز الحد الأقصى للطلبات. يرجى المحاولة لاحقاً" });
    };

  const apiLimiter = rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''),
    skip: (req) => isDedicatedSessionCheckRequest(req.method, req.originalUrl),
    handler: rateLimitHandler("api"),
    ...(redisStoreForApi ? { store: redisStoreForApi } : {}),
  });

  const sessionCheckLimiter = rateLimit({
    ...SESSION_CHECK_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''),
    skip: (req) => !isDedicatedSessionCheckRequest(req.method, req.originalUrl),
    handler: rateLimitHandler("session-check"),
    ...(redisStoreForSessionCheck ? { store: redisStoreForSessionCheck } : {}),
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

  app.use(sessionCheckLimiter);
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
        // فيديو البلاغات (مسجل من المتصفح عبر MediaRecorder، مضغوط مسبقاً ~720p/1.5Mbps)
        "video/mp4",
        "video/webm",
      ]);
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return cb(null, true);
      }
      // بعض متصفحات Android/iOS ترسل mimetype فارغًا أو application/octet-stream
      // لصور سليمة تمامًا — نقبلها بالاعتماد على الامتداد بدل رفضها عشوائيًا.
      // (كان هذا أحد أسباب فشل رفع الصورة "أحيانًا" بصفحة الصيانة الخارجية)
      const ALLOWED_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?|pdf|docx?|xlsx?|mp4|webm)$/i;
      const isAmbiguousMime = !file.mimetype || file.mimetype === "application/octet-stream";
      if (isAmbiguousMime && ALLOWED_EXT_RE.test(file.originalname || "")) {
        return cb(null, true);
      }
      const rejectError: any = new Error(`نوع الملف غير مسموح: ${file.mimetype || "غير معروف"}`);
      rejectError.status = 415;
      cb(rejectError);
    },
  });

  // multer يرمي أخطاءه داخل الـ middleware وليس داخل الـ handler، فبدون هذا الغلاف
  // كانت الأخطاء (حجم كبير / نوع غير مسموح) تخرج برمز 500 عام بدل رسالة مفهومة.
  const uploadSingleFile = (req: any, res: any, next: any) => {
    upload.single("file")(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "حجم الملف أكبر من الحد المسموح (16MB)" });
      }
      return res.status(err.status || 415).json({ error: err.message || "فشل استقبال الملف" });
    });
  };

  // رفع لـ S3 مع محاولة ثانية — أخطاء الشبكة العابرة نحو iDrive e2 كانت تُترجم
  // لـ 500 "Upload failed" متقطع بلا سبب ظاهر للمستخدم.
  const storagePutWithRetry = async (key: string, buffer: Buffer, mime: string) => {
    try {
      return await storagePut(key, buffer, mime);
    } catch (firstError: any) {
      console.warn("[Upload] فشلت المحاولة الأولى للرفع للتخزين، إعادة المحاولة:", firstError?.message);
      await new Promise(resolve => setTimeout(resolve, 700));
      return storagePut(key, buffer, mime);
    }
  };

  // MEDIA PROXY: serves images from iDrive e2 through the server
  // ============================================================
  // Same-origin <img> requests include the session cookie. Resolve the file's
  // actual parent before opening storage; a known key is not authorization.
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
      const user = await sdk.authenticateRequest(req);
      await assertMediaAccess(user, normalizedKey);
      const { stream, contentType } = await storageGetStream(normalizedKey);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Vary", "Cookie");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // إذا طُلب التنزيل، أضف Content-Disposition آمنًا للأسماء العربية.
      // Node.js يرفض الأحرف غير ASCII عندما توضع مباشرة داخل filename=، لذلك
      // نرسل اسمًا احتياطيًا ASCII مع filename*=UTF-8'' للاسم الحقيقي المشفّر.
      if (req.query.download === "1") {
        const requestedFilename =
          (typeof req.query.filename === "string" && req.query.filename.trim())
            ? req.query.filename.trim()
            : normalizedKey.split("/").pop() || "file";
        const filename = requestedFilename
          .replace(/[\r\n]/g, "")
          .replace(/[\/\\]/g, "_");
        const asciiFilename =
          filename
            .replace(/[^\x20-\x7E]/g, "_")
            .replace(/["\\;]/g, "_")
            .trim() || "file";
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
        );
      }
      (stream as any).pipe(res);
    } catch (error: any) {
      console.error("Media proxy error:", error);
      const status = isSessionAuthenticationError(error) ? 401 : error?.code === "FORBIDDEN" ? 403 : error?.code === "INTERNAL_SERVER_ERROR" ? 503 : 404;
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.status(status).json({ error: status === 401 ? "يجب تسجيل الدخول لفتح الملف" : "الملف غير متاح لحسابك" });
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
      const fileKey = `cmms/uploads/u-${req.authenticatedUser.id}/${Date.now()}-${nanoid(8)}.${ext}`;
      const { uploadUrl, proxyUrl } = await storagePresignedPut(fileKey, mime);
      res.json({ uploadUrl, proxyUrl, fileKey });
    } catch (e: any) {
      console.error("[Presigned URL] Error:", e.message);
      res.status(500).json({ error: "فشل إنشاء رابط الرفع" });
    }
  });

  app.post("/api/upload", requireAuthMiddleware, uploadSingleFile, async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      if (!req.file.size) return res.status(400).json({ error: "الملف وصل فارغًا (0 بايت) — أعد المحاولة" });
      const originalName: string = req.file.originalname || "";
      const looksLikeImage = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(originalName);
      const isImage = req.file.mimetype.startsWith("image/") || looksLikeImage;
      const isVideo = req.file.mimetype.startsWith("video/");
      let fileBuffer = req.file.buffer;
      let mimeType = req.file.mimetype;
      let ext = originalName.split(".").pop() || "bin";

      // تحويل الصور إلى WebP مع تقليص الأبعاد لتسريع الرفع
      if (isImage) {
        try {
          fileBuffer = await sharp(req.file.buffer)
            // Normalize EXIF Orientation first so mobile photos keep the same
            // visual direction they had when captured/selected by the user.
            .rotate()
            .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 75, effort: 2 })
            .toBuffer();
          mimeType = "image/webp";
          ext = "webp";
        } catch (imageError: any) {
          // النسخ الجاهزة من sharp لا تفك ترميز HEIC/HEIF (صور آيفون الافتراضية)،
          // وكان هذا يُرجع 500 "Upload failed" لبعض الصور دون غيرها.
          console.error("[Upload] فشلت معالجة الصورة:", imageError?.message);
          const isHeic = /heic|heif/i.test(req.file.mimetype) || /\.hei[cf]$/i.test(originalName);
          if (isHeic) {
            return res.status(415).json({
              error: "صيغة HEIC غير مدعومة — غيّر إعداد الكاميرا إلى \"الأكثر توافقًا/JPEG\" أو ارفع الصورة بصيغة JPG",
            });
          }
          // صيغة صالحة لكن sharp تعثّر: نرفع الملف الأصلي بدل إيقاف العملية
          fileBuffer = req.file.buffer;
          mimeType = req.file.mimetype || "application/octet-stream";
        }
      }

      // تحويل أي فيديو (WebM أو MP4 غير قياسي من تسجيل المتصفح) إلى
      // MP4/H.264 قياسي 100% متوافق مع كل الأجهزة، خصوصاً Safari/آيفون
      // التي ترفض ملفات الفيديو غير المطابقة تماماً للمعيار (بعكس Chrome المتساهل)
      if (isVideo) {
        try {
          fileBuffer = await transcodeVideoToCompatibleMp4(req.file.buffer);
          mimeType = "video/mp4";
          ext = "mp4";
        } catch (transcodeError: any) {
          console.error("[Video Transcode] فشل التحويل، سيتم رفع الملف الأصلي كما هو:", transcodeError.message);
          // في حال فشل التحويل لأي سبب، نرفع الملف الأصلي بدل إيقاف العملية بالكامل
        }
      }
      const fileKey = `cmms/uploads/u-${req.authenticatedUser.id}/${Date.now()}-${nanoid(8)}.${ext}`;
      await storagePutWithRetry(fileKey, fileBuffer, mimeType);
      // Always return proxy URL so images load reliably regardless of bucket ACL or CORS
      const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;
      res.json({ url: proxyUrl, fileKey });
    } catch (error: any) {
      console.error("Upload error:", error?.name, error?.message, error?.$metadata?.httpStatusCode);
      res.status(500).json({ error: "تعذّر حفظ الملف في التخزين — أعد المحاولة بعد لحظات" });
    }
  });

  // ============================================================
  // C-01 FIX: تأمين جميع Export endpoints بمصادقة + صلاحية
  // ============================================================

  // ============================================================
  // Main Phase 6.1 — Inventory Reports Center foundation preview
  // Real endpoints used to runtime-verify the shared Print / Excel / PDF stack
  // before report-specific data views are introduced in 6.2+.
  // ============================================================
  app.get("/api/reports/inventory/foundation-preview.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildReportsCenterPreviewExcel(req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Reports Foundation Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/foundation-preview.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildReportsCenterPreviewPdf(req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Reports Foundation PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/foundation-preview/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = buildReportsCenterPreviewPrintHtml(req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Reports Foundation Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  // ============================================================
  // Main Phase 6.2.1 — Stock Balance & Status report exports.
  // These endpoints are read-only and honor the same filters as the UI query.
  // ============================================================
  const stockBalanceFiltersFromRequest = (req: any): StockBalanceFilters => ({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    warehouseId: Number(req.query.warehouseId || 0) > 0 ? Number(req.query.warehouseId) : undefined,
    status: ["all", "normal", "low", "zero", "negative"].includes(String(req.query.status || "all"))
      ? String(req.query.status || "all") as StockBalanceFilters["status"]
      : "all",
  });

  app.get("/api/reports/inventory/stock-balance.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryStockBalanceExcel(stockBalanceFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Stock Balance Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/stock-balance.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryStockBalancePdf(stockBalanceFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Stock Balance PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/stock-balance/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryStockBalancePrintHtml(stockBalanceFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Stock Balance Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });


  // ============================================================
  // Main Phase 6.2.2 — Stock Card & Unified Movement Report exports.
  // Read-only; the export routes reuse the exact same filters/service as the UI.
  // ============================================================
  const inventoryMovementFiltersFromRequest = (req: any): InventoryMovementFilters => ({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    warehouseId: Number(req.query.warehouseId || 0) > 0 ? Number(req.query.warehouseId) : undefined,
    movementType: ["all", "purchase", "return", "delivery", "adjustment", "disposal", "transfer"].includes(String(req.query.movementType || "all"))
      ? String(req.query.movementType || "all") as InventoryMovementFilters["movementType"]
      : "all",
    direction: ["all", "in", "out"].includes(String(req.query.direction || "all"))
      ? String(req.query.direction || "all") as InventoryMovementFilters["direction"]
      : "all",
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    itemKey: typeof req.query.itemKey === "string" ? req.query.itemKey : undefined,
  });

  app.get("/api/reports/inventory/movements.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryMovementExcel(inventoryMovementFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Movements Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/movements.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryMovementPdf(inventoryMovementFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Movements PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/movements/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryMovementPrintHtml(inventoryMovementFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Movements Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });


  // ============================================================
  // Main Phase 6.3.1 — Inventory Valuation report exports.
  // Read-only; uses stored inventory.totalCostValue as the valuation basis.
  // ============================================================
  const inventoryValuationFiltersFromRequest = (req: any): InventoryValuationFilters => ({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    warehouseId: Number(req.query.warehouseId || 0) > 0 ? Number(req.query.warehouseId) : undefined,
    status: ["all", "positive", "zero", "negative"].includes(String(req.query.status || "all"))
      ? String(req.query.status || "all") as InventoryValuationFilters["status"]
      : "all",
  });

  app.get("/api/reports/inventory/valuation.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValuationExcel(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Valuation Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/valuation.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValuationPdf(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Valuation PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/valuation/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryValuationPrintHtml(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Valuation Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  // ============================================================
  // Former 6.3.2 / current merged 6.3.1 — Value by Warehouse / Category exports.
  // Read-only; grouped from the same stored totalCostValue rows used by 6.3.1.
  // ============================================================
  app.get("/api/reports/inventory/valuation/by-warehouse.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValueByWarehouseExcel(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Value by Warehouse Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/valuation/by-warehouse.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValueByWarehousePdf(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Value by Warehouse PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/valuation/by-warehouse/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryValueByWarehousePrintHtml(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Value by Warehouse Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  app.get("/api/reports/inventory/valuation/by-category.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValueByCategoryExcel(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Value by Category Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/valuation/by-category.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryValueByCategoryPdf(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Value by Category PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/valuation/by-category/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryValueByCategoryPrintHtml(inventoryValuationFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Value by Category Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  // ============================================================
  // Merged Main Phase 6.3.2 — Inventory Variance & Accounting Review exports.
  // Read-only; reuses 6.3.1 stored values and Main Phase 5.4 reconciliation evidence.
  // ============================================================
  const inventoryAccountingReviewFiltersFromRequest = (req: any): InventoryAccountingReviewFilters => ({
    ...inventoryValuationFiltersFromRequest(req),
    category: typeof req.query.category === "string" ? req.query.category : "all",
    condition: ["all", "value_mismatch", "negative_stored_value", "negative_quantity", "reconciliation_exception"].includes(String(req.query.condition || "all"))
      ? String(req.query.condition || "all") as InventoryAccountingReviewFilters["condition"]
      : "all",
  });

  app.get("/api/reports/inventory/valuation/accounting-review.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryAccountingReviewExcel(inventoryAccountingReviewFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Accounting Review Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/valuation/accounting-review.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryAccountingReviewPdf(inventoryAccountingReviewFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Accounting Review PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/valuation/accounting-review/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryAccountingReviewPrintHtml(inventoryAccountingReviewFiltersFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Accounting Review Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  // ============================================================
  // Main Phase 6.4 — Inventory Analytics & Planning exports.
  // Read-only; current stored values + recorded movements/lots only.
  // ============================================================
  const inventoryAnalyticsFiltersFromRequest = (req: any): InventoryAnalyticsFilters => ({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    warehouseId: Number(req.query.warehouseId || 0) > 0 ? Number(req.query.warehouseId) : undefined,
    category: typeof req.query.category === "string" ? req.query.category : "all",
    slowDays: Number(req.query.slowDays || 90),
    deadDays: Number(req.query.deadDays || 180),
    turnoverDays: Number(req.query.turnoverDays || 365),
  });
  const inventoryAnalyticsViewFromRequest = (req: any): InventoryAnalyticsView => {
    const view = String(req.query.view || "slow");
    return ["slow", "dead", "abc", "aging", "turnover"].includes(view) ? view as InventoryAnalyticsView : "slow";
  };

  app.get("/api/reports/inventory/analytics.xlsx", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryAnalyticsExcel(inventoryAnalyticsFiltersFromRequest(req), inventoryAnalyticsViewFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Analytics Excel]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف Excel" });
    }
  });

  app.get("/api/reports/inventory/analytics.pdf", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const { buffer, contentDisposition } = await buildInventoryAnalyticsPdf(inventoryAnalyticsFiltersFromRequest(req), inventoryAnalyticsViewFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", contentDisposition);
      res.send(buffer);
    } catch (e: any) {
      console.error("[Inventory Analytics PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء ملف PDF" });
    }
  });

  app.get("/api/reports/inventory/analytics/print", requireInventoryExportRole, async (req: any, res: any) => {
    try {
      const html = await buildInventoryAnalyticsPrintHtml(inventoryAnalyticsFiltersFromRequest(req), inventoryAnalyticsViewFromRequest(req), req.query.lang);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) {
      console.error("[Inventory Analytics Print]", e);
      res.status(500).send("تعذر تجهيز معاينة الطباعة");
    }
  });

  app.get("/api/export/tickets", requireTicketExportRole, async (_req: any, res: any) => {
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

  const handleInventoryExport = async (req: any, res: any) => {
    try {
      if (Number(req.authenticatedUser?.isActive) !== 1) return res.status(403).json({ error: "الحساب غير نشط" });
      const rawBookFilters = req.method === "POST" ? req.body?.bookFilters : undefined;
      const parsedBooks = rawBookFilters === undefined ? undefined : inventoryBookExportFilterSchema.safeParse(rawBookFilters);
      if (parsedBooks && !parsedBooks.success) return res.status(400).json({ error: "فلاتر تصدير المخزون غير صالحة" });
      const rawItemIds = req.method === "POST" ? req.body?.itemIds : undefined;
      let itemIds: number[] | undefined;

      if (rawItemIds !== undefined) {
        if (!Array.isArray(rawItemIds)) {
          return res.status(400).json({ error: "itemIds must be an array" });
        }
        itemIds = Array.from(new Set(
          rawItemIds
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value > 0),
        ));
      }

      const bookFilters = parsedBooks?.success ? parsedBooks.data : undefined;
      const buffer = await exportInventoryToExcel(itemIds === undefined && !bookFilters ? undefined : { itemIds, bookFilters });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=inventory-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  };

  // صفحة Inventory تستخدم POST لإرسال معرّفات النتائج بعد تطبيق الفلاتر
  // بدون قيود طول Query String.
  app.post("/api/export/inventory", requireInventoryExportRole, handleInventoryExport);

  app.get("/api/export/preventive-plans", requireOwnerAdminExportRole, async (_req: any, res: any) => {
    try {
      const buffer = await exportPreventivePlansToExcel();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=preventive-plans-${Date.now()}.xlsx`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/export/pm-work-orders", requireOwnerAdminExportRole, async (_req: any, res: any) => {
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
  app.get("/api/export/pm-work-order/:id", requireOwnerAdminExportRole, async (req: any, res: any) => {
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

  // Ticket documents: active task sheet + closed archival record.
  // Visibility is enforced here as well as in the UI so direct URL access cannot bypass the workflow.
  app.get("/api/tickets/:id/pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) return res.status(400).json({ error: "رقم البلاغ غير صحيح" });

      const documentType: TicketPdfDocumentType = req.query.document === "archive" ? "archive" : "task";
      const ticket = await getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ error: "البلاغ غير موجود" });

      try {
        await assertTicketReadable(req.authenticatedUser, ticket as any);
      } catch {
        return res.status(403).json({ error: "ليس لديك صلاحية للاطلاع على مستندات هذا البلاغ" });
      }

      if (documentType === "archive") {
        if (!canDownloadTicketArchive(req.authenticatedUser.role, ticket.status)) {
          return res.status(403).json({ error: "التقرير الأرشيفي متاح بعد إغلاق البلاغ للأدوار المخولة فقط" });
        }
      } else if (!canPrintTicketTask(req.authenticatedUser.role, ticket.status)) {
        return res.status(403).json({ error: "طباعة المهمة متاحة بعد تصنيف البلاغ وفق الصلاحيات المحددة" });
      }

      const buffer = await generateTicketPDF(ticketId, documentType, req.authenticatedUser?.preferredLanguage);
      res.setHeader("Content-Type", "application/pdf");
      const disposition = documentType === "archive" ? "attachment" : "inline";
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename=ticket-${documentType}-${ticket.ticketNumber}-${Date.now()}.pdf`,
      );
      res.send(buffer);
    } catch (e: any) {
      console.error("[Ticket PDF]", e);
      res.status(500).json({ error: e.message || "تعذر إنشاء مستند البلاغ" });
    }
  });

  // ============================================================
  // تصدير PDF عام من HTML جاهز — لمركز المستندات (زر "عرض/تنزيل PDF")
  // العميل يبني نفس HTML المستخدم فعلاً لنوافذ الطباعة (بلا أي تكرار
  // لمنطق القوالب)، ويرسله هنا فقط ليُحوَّل لملف PDF حقيقي عبر نفس
  // خدمة htmlToPdfService (Puppeteer) المستخدمة لتصدير طلبات الشراء.
  // الحسابات والإدارة العليا تستخدمان مرجع مستند مخزون محدد بدل HTML
  // العميل؛ يُعاد بناؤه بعد حارس القراءة الأصلي لمنع تجاوز اعتماد PDF المالي.
  // ============================================================
  app.post("/api/export/html-to-pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const { html, filename } = await resolveDocumentPdfInput(req.authenticatedUser, req.body, source =>
        canonicalInventoryDocument(source, appRouter.createCaller({ req, res, user: req.authenticatedUser,
          authenticatedUser: req.authenticatedUser }) as any, req.authenticatedUser));
      const buffer = await htmlToPdf(html);
      const safeName = (filename && typeof filename === "string" ? filename : `document-${Date.now()}`).replace(/[^\w\u0600-\u06FF.-]+/g, "-");
      const download = req.query.download === "1" || req.query.download === "true";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${safeName}.pdf"`);
      res.send(buffer);
    } catch (e: any) {
      console.error("[HTML→PDF Export Error]", e.message);
      res.status(e?.code === "FORBIDDEN" ? 403 : e?.code === "NOT_FOUND" ? 404 : e?.code === "BAD_REQUEST" ? 400 : 500).json({ error: e.message });
    }
  });

  // Purchase Request PDF export — delegate pricing workflow (auth required)
  app.get("/api/export/po/:id/pdf", requireAuthMiddleware, async (req: any, res: any) => {
    try {
      const poId = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(poId)) return res.status(400).json({ error: "Invalid purchase request ID" });
      const batchIdRaw = req.query.batchId;
      const batchId = batchIdRaw === undefined ? undefined : typeof batchIdRaw === "string" && /^[1-9]\d*$/.test(batchIdRaw) ? Number(batchIdRaw) : NaN;
      // [PB 2026-08-29] وضع الدفعة الفرعية — مستند واحد لإرسال واحد قد يضم
      // أصنافًا من عدة طلبات، بنفس القالب مع عمود "رقم الطلب". بدون هذا
      // المعامل يعمل المسار تمامًا كما كان.
      const submissionIdRaw = req.query.submissionId;
      const submissionId = submissionIdRaw === undefined ? undefined : typeof submissionIdRaw === "string" && /^[1-9]\d*$/.test(submissionIdRaw) ? Number(submissionIdRaw) : NaN;
      const user = req.authenticatedUser;
      const po = await authorizePurchaseDocument(user, poId, batchId, submissionId);

      // إذا أُرسل التسعير ضمن دفعة حزمة، فالمستند الرسمي للمندوب والحسابات
      // هو مستند purchase_package_submission. نمنع PDF مستقل للـ PR لهذين
      // الدورين حتى لا توجد وثيقتا عهدة لنفس الإرسال. الإدارة/المالك يحتفظون
      // بصلاحيات الاستعراض الحالية لأغراض التدقيق.
      const { getPOPricingBatchById, getPOPricingBatches } = await import("./db");
      const mustUsePackageOfficialDocument = ["delegate", "delegate_manager", "accountant"].includes(user?.role || "");
      if (mustUsePackageOfficialDocument && !submissionId) {
        if (batchId) {
          const requestedBatch = await getPOPricingBatchById(batchId);
          if (
            requestedBatch?.purchaseOrderId === poId &&
            requestedBatch?.purchasePackageSubmissionId != null
          ) {
            return res.status(403).json({
              error: "هذا الطلب أُرسل ضمن دفعة حزمة. استخدم مستند دفعة الإرسال الرسمي لطلب العهدة.",
              purchasePackageSubmissionId: requestedBatch.purchasePackageSubmissionId,
            });
          }
        } else {
          const poBatches = await getPOPricingBatches(poId);
          const packageBatch = (poBatches as any[]).find(
            (b: any) => b.purchasePackageSubmissionId != null
          );
          if (packageBatch) {
            return res.status(403).json({
              error: "هذا الطلب يحتوي تسعيرًا أُرسل ضمن دفعة حزمة. استخدم مستند دفعة الإرسال الرسمي لطلب العهدة.",
              purchasePackageSubmissionId: packageBatch.purchasePackageSubmissionId,
            });
          }
        }
      }

      const buffer = await generatePurchaseRequestPDF(poId, user.id, batchId, submissionId);
      const filename = po?.poNumber
        ? (submissionId ? `دفعة-${submissionId}.pdf` : batchId ? `${po.poNumber}-batch${batchId}.pdf` : `${po.poNumber}.pdf`)
        : `po-${poId}.pdf`;
      // أسماء الملفات العربية لا يجوز وضعها مباشرة داخل ترويسة HTTP في Node.js.
      // نرسل اسمًا احتياطيًا ASCII مع filename*=UTF-8 للحفاظ على الاسم العربي
      // في المتصفحات الداعمة، بدون تغيير ملف PDF أو منطق التصدير نفسه.
      const asciiFilename = submissionId
        ? `batch-${submissionId}.pdf`
        : filename.replace(/[^\x20-\x7E]/g, "-");
      const encodedFilename = encodeURIComponent(filename);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.send(buffer);
} catch (e: any) { console.error("[PDF Export Error]", e.message); res.status(e?.code === "FORBIDDEN" ? 403 : e?.code === "NOT_FOUND" ? 404 : 500).json({ error: e.message }); }
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
    // فحص التخزين بعد الإقلاع مباشرة — لا يمنع تشغيل السيرفر ولا يؤخّر الاستماع،
    // لكنه يكشف خطأ مفتاح/صلاحية/مستودع خلال ثانيتين بدل انتظار شكوى مستخدم.
    void checkStorageHealth();
    void startBackgroundJobsWhenDatabaseReady();
  });

  let backgroundJobsStarted = false;

  function scheduleBackgroundJobs() {
    if (backgroundJobsStarted) return;
    backgroundJobsStarted = true;

  // استعادة الـ translation jobs المعلقة عند بدء التشغيل، ثم دوريًا كل 30 دقيقة
  // (كانت سابقاً تُنفَّذ مرة واحدة فقط عند الإقلاع — أي مهمة تُفقَد بسبب إعادة تشغيل
  // الخادم أثناء انتظار setTimeout الخاص بها كانت تبقى عالقة للأبد حتى إعادة التشغيل
  // التالية. أُضيفت أيضاً queueMissingTranslations لتغطية حالة أخطر: بلاغات لم تُنشأ
  // لها أي مهمة ترجمة إطلاقاً بسبب فشل صامت في queueTranslation نفسه عند الإنشاء)
  const THIRTY_MINUTES = 30 * 60 * 1000;
  setTimeout(async () => {
    const runTranslationRecovery = async () => {
      try {
        const { recoverPendingTranslations, queueMissingTranslations } = await import("../services/translation/translationEngine");
        await recoverPendingTranslations();
        await queueMissingTranslations();
      } catch (e) {
        console.error("[TranslationRecovery] Failed:", e);
      }
    };
    await runTranslationRecovery();
    setInterval(runTranslationRecovery, THIRTY_MINUTES);
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

  // PM V2 Scheduler: independent from Legacy PM automation; idempotent date-only generation.
  const PMV2_ONE_HOUR = 60 * 60 * 1000;
  setTimeout(() => {
    runPmv2SchedulerJob();
    setInterval(runPmv2SchedulerJob, PMV2_ONE_HOUR);
  }, 12000);

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
  }

  const DATABASE_STARTUP_RETRY_DELAYS_MS = [5000, 10000, 20000, 30000] as const;

  async function startBackgroundJobsWhenDatabaseReady(attempt = 0): Promise<void> {
    // Explicit opt-out for local acceptance runs; normal deployments keep the
    // existing scheduling behavior when this variable is absent.
    if (process.env.BACKGROUND_JOBS_ENABLED === "false") {
      console.log("[Jobs] Background jobs explicitly disabled");
      return;
    }
    if (backgroundJobsStarted) return;

    try {
      const database = await getDb();
      if (database) {
        console.log("[Jobs] Database ready; scheduling background jobs");
        scheduleBackgroundJobs();
        return;
      }
    } catch (error) {
      console.warn("[Jobs] Database readiness check failed:", error);
    }

    const retryDelay = DATABASE_STARTUP_RETRY_DELAYS_MS[
      Math.min(attempt, DATABASE_STARTUP_RETRY_DELAYS_MS.length - 1)
    ];
    console.warn(`[Jobs] Database unavailable; retrying background startup in ${retryDelay / 1000}s`);
    setTimeout(() => void startBackgroundJobsWhenDatabaseReady(attempt + 1), retryDelay);
  }

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
