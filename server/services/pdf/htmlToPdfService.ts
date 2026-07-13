/**
 * htmlToPdfService.ts
 * ============================================================
 * Isolated, reusable HTML-to-PDF rendering service using
 * Puppeteer + Chromium.
 *
 * Scope: ONLY used for delegate purchasing PDF export.
 * Future reports may reuse this helper, but NO existing
 * exports have been migrated.
 *
 * Railway / Alpine Linux compatible:
 *   - Uses chromium from apk (installed via Dockerfile)
 *   - Safe container flags: --no-sandbox, --disable-setuid-sandbox
 *   - process.cwd() used for any path resolution (ESM-safe)
 * ============================================================
 */

import puppeteer, { Browser } from "puppeteer-core";

/** Chromium executable paths to try in order of preference */
const CHROMIUM_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,   // explicit env override
  "/usr/bin/chromium-browser",             // Alpine apk chromium
  "/usr/bin/chromium",                     // alternative Alpine path
  "/usr/bin/google-chrome",               // Debian/Ubuntu chrome
  "/usr/bin/google-chrome-stable",        // Debian stable
];

function resolveChromiumPath(): string {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (candidate) return candidate;
  }
  throw new Error(
    "No Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH or install chromium."
  );
}

// ============================================================
// ✅ إصلاح "Target closed" على Railway/الحاويات محدودة الرام:
// إطلاق متصفح Chromium كامل من الصفر مع كل طلب تصدير كان بيستهلك رام كبيرة
// جداً (~200-300MB لكل متصفح)، ولو حصلت طلبات متزامنة (مندوب + حسابات مثلاً)
// كانت الحاوية بتوصل لحد الرام فيقفل النظام العملية فجأة (OOM) قبل ما تخلّص.
// الحل: متصفح واحد مشترك يُفتح مرة واحدة ويُعاد استخدامه لكل الطلبات (بس
// صفحة/تبويب جديد لكل تصدير)، مع إعادة تشغيله تلقائياً لو قفل لأي سبب.
// ============================================================
let sharedBrowser: Browser | null = null;
let launchingPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveChromiumPath();
  return puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 120000, // مهلة أطول لمنع "Target closed" على الحاويات البطيئة
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      // ملاحظة: أُزيلت --single-process و --no-zygote لأنهما أشهر سبب لانهيار
      // Chromium فجأة بـ "Target closed" داخل حاويات Docker/Railway.
      // أعلام إضافية لتقليل استهلاك الرام والمعالجة على حاويات محدودة الموارد
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-ipc-flooding-protection",
      "--disable-renderer-backgrounding",
      "--force-color-profile=srgb",
      "--metrics-recording-only",
      "--mute-audio",
    ],
  });
}

async function getBrowser(): Promise<Browser> {
  // متصفح شغّال وسليم بالفعل — استخدمه كما هو
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }
  // طلب إطلاق شغّال بالفعل (طلب متزامن آخر بدأ التشغيل) — استنّى نفس النتيجة
  // بدل ما نفتح متصفحين في نفس اللحظة
  if (launchingPromise) {
    return launchingPromise;
  }
  launchingPromise = launchBrowser();
  try {
    sharedBrowser = await launchingPromise;
    sharedBrowser.on("disconnected", () => {
      // المتصفح قفل (سواء يدوياً أو بسبب OOM) — نمسحه عشان next call يفتح واحد جديد
      sharedBrowser = null;
    });
    return sharedBrowser;
  } finally {
    launchingPromise = null;
  }
}

/**
 * Renders an HTML string to a PDF Buffer using Chromium.
 *
 * @param html  Full HTML document string (must include <html>, <head>, <body>)
 * @returns     PDF as a Buffer
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  // محاولتين: لو المتصفح المشترك اتقفل فجأة أثناء التنفيذ (Target closed)،
  // نعيد المحاولة مرة واحدة بمتصفح جديد بدل ما نفشل فورًا
  let lastError: any;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        // ✅ الحل الجذري لمشكلة قص الصفحة من الجانب:
        // بدون هذا، Puppeteer يرسم الصفحة بعرض افتراضي 800px (viewport)، ثم يضغطها
        // داخل عرض A4 الأصغر عند التصدير — فيتجاوز المحتوى حدود الصفحة وينقطع من الجانب.
        // بضبط viewport بنفس عرض A4 الصافي (بعد طرح الهوامش)، يُرسم المحتوى من البداية
        // بالعرض الصحيح فلا يحدث أي تجاوز أو قص.
        // A4 = 210mm، الهامش 15mm يمين + 15mm يسار → العرض الصافي 180mm ≈ 680px عند 96dpi
        await page.setViewport({ width: 680, height: 960, deviceScaleFactor: 2 });

        // ✅ بدون هذا السطر، قواعد @media print في CSS (عرض الصفحة 210mm، تقسيم الصفحات،
        // منع قص الجداول والصور) لا تُطبَّق أبداً لأن Puppeteer يستخدم media type "screen"
        // افتراضياً — وهذا هو السبب الجذري لقص الصفحة من الجانب واختفاء بعض البيانات.
        await page.emulateMediaType("print");

        await page.setContent(html, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
        });

        return Buffer.from(pdfBuffer);
      } finally {
        await page.close().catch(() => {});
      }
    } catch (err: any) {
      lastError = err;
      console.error(`[PDF Export Error] Attempt ${attempt}:`, err?.message || err);
      // لو المتصفح قفل فجأة، امسحه وخلي المحاولة الجاية تفتح واحد جديد
      sharedBrowser = null;
    }
  }
  throw lastError;
}
