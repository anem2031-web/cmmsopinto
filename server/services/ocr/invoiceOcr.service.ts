// ============================================================
// server/services/ocr/invoiceOcr.service.ts
// خدمة تحليل الفواتير بالذكاء الاصطناعي
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const client = new Anthropic();

// S3 client - نفس إعدادات storage.ts
const s3 = new S3Client({
  endpoint:    process.env.S3_ENDPOINT || "https://s3.eu-central-1.idrivee2.com",
  region:      process.env.S3_REGION   || "eu-central-1",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const S3_BUCKET = process.env.S3_BUCKET || "cmms-uploads";

export interface OcrExtractedItem {
  itemName:         string;
  itemNameEn?:      string;
  quantity:         number;
  unit?:            string;
  unitPrice:        number;
  taxRate:          number;
  taxAmount:        number;
  lineTotal:        number;
  confidence:       number;
}

export interface OcrInvoiceResult {
  vendorName?:       string;
  vendorNameEn?:     string;
  vendorTaxNumber?:  string;
  invoiceNumber?:    string;
  invoiceDate?:      string;
  subtotal?:         number;
  taxAmount?:        number;
  grandTotal?:       number;
  items:             OcrExtractedItem[];
  overallConfidence: number;
}

const INVOICE_PROMPT = `أنت محلل فواتير متخصص. قم بتحليل صورة الفاتورة المرفقة واستخراج البيانات بدقة.

استخرج البيانات التالية وأعدها بصيغة JSON فقط بدون أي نص إضافي:

{
  "vendorName": "اسم المورد بالعربي",
  "vendorNameEn": "اسم المورد بالإنجليزي إن وجد",
  "vendorTaxNumber": "الرقم الضريبي (15 رقم في السعودية تبدأ بـ 3)",
  "invoiceNumber": "رقم الفاتورة",
  "invoiceDate": "تاريخ الفاتورة بصيغة YYYY-MM-DD",
  "subtotal": 0.00,
  "taxAmount": 0.00,
  "grandTotal": 0.00,
  "items": [
    {
      "itemName": "اسم الصنف بالعربي",
      "itemNameEn": "اسم الصنف بالإنجليزي إن وجد",
      "quantity": 0,
      "unit": "وحدة القياس",
      "unitPrice": 0.00,
      "taxRate": 15,
      "taxAmount": 0.00,
      "lineTotal": 0.00,
      "confidence": 0.95
    }
  ],
  "overallConfidence": 0.90
}

قواعد مهمة:
- إذا لم تجد قيمة معينة، اتركها null وليس فارغة
- الرقم الضريبي السعودي يبدأ بـ 3 ويتكون من 15 رقم
- نسبة الضريبة في السعودية 15% إلا إذا كانت مختلفة في الفاتورة
- confidence هي نسبة ثقتك في دقة الاستخراج من 0 إلى 1
- أرجع JSON فقط بدون أي تفسير أو نص إضافي`;

// ─────────────────────────────────────────────────────────────
// استخراج مفتاح S3 من الرابط
// ─────────────────────────────────────────────────────────────
function extractKeyFromUrl(imageUrl: string): string | null {
  if (imageUrl.includes("/api/media")) {
    try {
      const url = new URL(imageUrl, "http://localhost");
      const key = url.searchParams.get("key");
      return key ? decodeURIComponent(key) : null;
    } catch {
      return null;
    }
  }
  if (imageUrl.startsWith("cmms/")) return imageUrl;
  return null;
}

// ─────────────────────────────────────────────────────────────
// قراءة الصورة مباشرة من S3 بدون presigned URL
// AWS SDK v3 - transformToByteArray
// ─────────────────────────────────────────────────────────────
async function downloadImageFromS3(s3Key: string): Promise<{ base64: string; mimeType: string }> {
  const normalizedKey = s3Key.replace(/^\/+/, "");
  console.log("[OCR] Reading from S3, key:", normalizedKey);

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key:    normalizedKey,
  });

  const response = await s3.send(command);

  if (!response.Body) {
    throw new Error("S3 returned empty body");
  }

  // AWS SDK v3 الطريقة الصحيحة
  const bytes = await (response.Body as any).transformToByteArray();
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = response.ContentType || "image/webp";

  console.log("[OCR] S3 read success, size:", base64.length, "chars, mime:", mimeType);
  return { base64, mimeType };
}

// ─────────────────────────────────────────────────────────────
// تحليل فاتورة من URL
// ─────────────────────────────────────────────────────────────
export async function analyzeInvoiceFromUrl(imageUrl: string): Promise<{
  result: OcrInvoiceResult;
  rawResponse: string;
  processingMs: number;
}> {
  const startTime = Date.now();

  const s3Key = extractKeyFromUrl(imageUrl);
  if (!s3Key) {
    throw new Error(`لا يمكن استخراج مفتاح الصورة من: ${imageUrl}`);
  }

  const { base64, mimeType } = await downloadImageFromS3(s3Key);
  return analyzeFromBase64(base64, mimeType, startTime);
}

// ─────────────────────────────────────────────────────────────
// تحليل فاتورة من base64 مباشرة
// ─────────────────────────────────────────────────────────────
export async function analyzeInvoiceFromBase64(
  base64Image: string,
  mimeType: string = "image/jpeg"
): Promise<{
  result: OcrInvoiceResult;
  rawResponse: string;
  processingMs: number;
}> {
  return analyzeFromBase64(base64Image, mimeType, Date.now());
}

// ─────────────────────────────────────────────────────────────
// الدالة المشتركة للتحليل
// ─────────────────────────────────────────────────────────────
async function analyzeFromBase64(
  base64: string,
  mimeType: string,
  startTime: number
): Promise<{
  result: OcrInvoiceResult;
  rawResponse: string;
  processingMs: number;
}> {
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const finalMime = allowed.includes(mimeType) ? mimeType : "image/jpeg";

  console.log("[OCR] Calling Anthropic API, mime:", finalMime);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type:       "base64",
              media_type: finalMime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data:       base64,
            },
          },
          {
            type: "text",
            text: INVOICE_PROMPT,
          },
        ],
      },
    ],
  });

  console.log("[OCR] Anthropic responded, blocks:", response.content?.length);

  const content = response.content;
  if (!content || content.length === 0) {
    throw new Error("الذكاء الاصطناعي لم يرجع أي محتوى");
  }

  const rawText = content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();

  console.log("[OCR] Raw text length:", rawText.length);

  if (!rawText) {
    throw new Error(`محتوى غير نصي: ${JSON.stringify(content[0])}`);
  }

  const processingMs = Date.now() - startTime;

  const cleanJson = rawText
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    // تحقق إذا كان الرد منقطعاً بسبب كثرة الأصناف
    const isTokenLimit = rawText.includes('"items": [') && !rawText.trimEnd().endsWith('}');
    if (isTokenLimit) {
      throw new Error("فشل تحليل الفاتورة — الفاتورة تحتوي أصناف كثيرة جداً، يرجى التواصل مع الدعم لرفع التوكن\nInvoice analysis failed — Too many items in invoice, please contact support to increase token limit");
    }
    throw new Error("فشل تحليل الفاتورة — تعذّر قراءة بيانات الفاتورة، يرجى التحقق من وضوح الصورة\nInvoice analysis failed — Could not read invoice data, please ensure image is clear");
  }

  console.log("[OCR] Parsed OK, confidence:", parsed?.overallConfidence, "items:", parsed?.items?.length);

  return {
    result: sanitizeOcrResult(parsed),
    rawResponse: rawText,
    processingMs,
  };
}

// ─────────────────────────────────────────────────────────────
// تنظيف البيانات المستخرجة
// ─────────────────────────────────────────────────────────────
function sanitizeOcrResult(raw: any): OcrInvoiceResult {
  if (!raw || typeof raw !== "object") {
    return { items: [], overallConfidence: 0 };
  }

  const result: OcrInvoiceResult = {
    vendorName:        raw.vendorName    || undefined,
    vendorNameEn:      raw.vendorNameEn  || undefined,
    vendorTaxNumber:   sanitizeTaxNumber(raw.vendorTaxNumber),
    invoiceNumber:     raw.invoiceNumber || undefined,
    invoiceDate:       sanitizeDate(raw.invoiceDate),
    subtotal:          toNumber(raw.subtotal),
    taxAmount:         toNumber(raw.taxAmount),
    grandTotal:        toNumber(raw.grandTotal),
    overallConfidence: Math.min(1, Math.max(0, toNumber(raw.overallConfidence) || 0.5)),
    items:             [],
  };

  if (Array.isArray(raw.items)) {
    result.items = raw.items.map((item: any) => ({
      itemName:   item?.itemName   || "صنف غير محدد",
      itemNameEn: item?.itemNameEn || undefined,
      quantity:   Math.max(0, toNumber(item?.quantity)  || 1),
      unit:       item?.unit       || undefined,
      unitPrice:  Math.max(0, toNumber(item?.unitPrice) || 0),
      taxRate:    Math.max(0, toNumber(item?.taxRate)   || 15),
      taxAmount:  Math.max(0, toNumber(item?.taxAmount) || 0),
      lineTotal:  Math.max(0, toNumber(item?.lineTotal) || 0),
      confidence: Math.min(1, Math.max(0, toNumber(item?.confidence) || 0.5)),
    }));
  }

  if (!result.subtotal && result.items.length > 0)
    result.subtotal   = Math.round(result.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) * 100) / 100;
  if (!result.taxAmount && result.items.length > 0)
    result.taxAmount  = Math.round(result.items.reduce((s, i) => s + i.taxAmount, 0) * 100) / 100;
  if (!result.grandTotal && result.subtotal)
    result.grandTotal = Math.round(((result.subtotal || 0) + (result.taxAmount || 0)) * 100) / 100;

  return result;
}

function toNumber(val: any): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val.replace(/,/g, "")) || 0;
  return 0;
}

function sanitizeTaxNumber(val: any): string | undefined {
  if (!val) return undefined;
  const cleaned = String(val).replace(/\s/g, "");
  if (/^3\d{14}$/.test(cleaned)) return cleaned;
  return cleaned || undefined;
}

function sanitizeDate(val: any): string | undefined {
  if (!val) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch {}
  return undefined;
}
