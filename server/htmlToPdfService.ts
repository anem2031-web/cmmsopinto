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

import puppeteer from "puppeteer-core";

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

/**
 * Renders an HTML string to a PDF Buffer using Chromium.
 *
 * @param html  Full HTML document string (must include <html>, <head>, <body>)
 * @returns     PDF as a Buffer
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const executablePath = resolveChromiumPath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
