/**
 * server.js — خدمة محلية صغيرة (تعمل فقط على جهاز الويندوز المتصل بالسكانر)
 * بتفتح بوابة على http://localhost:5588 وتشغّل السكانر عند الطلب عبر WIA.
 *
 * التشغيل:
 *   1) npm install   (مرة واحدة فقط)
 *   2) npm start      (أو دبل-كليك على start.bat)
 *   يجب إبقاء النافذة دي شغّالة وقت استخدام زر "مسح ضوئي من الطابعة" بالموقع.
 */
const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 5588;
const app = express();
app.use(cors()); // مفتوح محليًا فقط — الخدمة أصلاً غير متاحة إلا من نفس الجهاز

// ── دعم "Private Network Access" (سياسة أمان في المتصفحات الحديثة، خصوصاً Chrome) ──
// بدون الهيدر ده، أي طلب fetch() جافاسكريبت من صفحة الموقع لهذا البورت المحلي
// هيتمنع بصمت (Failed to fetch)، حتى لو فتح نفس الرابط مباشرة في المتصفح شغّال عادي.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Private-Network", "true");
  next();
});
app.options("*", cors()); // معالجة صريحة لأي طلب preflight (OPTIONS)

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "خدمة السكانر المحلية شغّالة" });
});

app.post("/scan", (req, res) => {
  const tempDir = os.tmpdir();
  const outputPath = path.join(tempDir, `cmms-scan-${Date.now()}.jpg`);
  const scriptPath = path.join(__dirname, "scan.ps1");

  execFile(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-OutputPath", outputPath],
    { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      // نقرأ آخر سطر JSON من stdout (بغض النظر عن أي تحذيرات PowerShell إضافية)
      let result = null;
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        result = JSON.parse(lines[lines.length - 1]);
      } catch {
        result = null;
      }

      if (error && !result) {
        console.error("[Scanner] فشل تشغيل سكربت المسح:", error.message, stderr);
        return res.status(500).json({
          error: "تعذر تشغيل السكانر. تأكد إن PowerShell مسموح له بالتشغيل وإن السكانر متصل.",
          details: stderr || error.message,
        });
      }

      if (!result || !result.success) {
        const msg = result?.error || "فشل غير معروف أثناء المسح";
        console.error("[Scanner]", msg);
        return res.status(422).json({ error: msg });
      }

      // نجاح — نقرأ الملف الناتج ونرجعه كصورة مباشرة
      fs.readFile(result.path, (readErr, data) => {
        if (readErr) {
          return res.status(500).json({ error: "تم المسح لكن تعذرت قراءة الملف الناتج." });
        }
        res.setHeader("Content-Type", "image/jpeg");
        res.send(data);
        // تنظيف الملف المؤقت بعد الإرسال
        fs.unlink(result.path, () => {});
      });
    }
  );
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ خدمة السكانر المحلية شغّالة على http://localhost:${PORT}`);
  console.log("سيبها شغّالة وارجع لصفحة رفع فاتورة المورد بالموقع واضغط 'مسح ضوئي من الطابعة'.");
});
