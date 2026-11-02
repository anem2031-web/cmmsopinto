// Browser fixture only. No application environment, API, or database access.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const assets = path.join(root, "dist/public/assets");
const css = fs.readFileSync(
  path.join(
    assets,
    fs.readdirSync(assets).find(n => /^index-.*\.css$/.test(n))
  ),
  "utf8"
);
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {TicketSequentialTasksView} from './client/src/pages/maintenance-teams/TicketSequentialTasksView';
      async function main() {
        const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=360;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#087c90'; ctx.fillRect(0,0,640,360);
        ctx.fillStyle='white'; ctx.font='32px sans-serif'; ctx.fillText('Report media preview',110,180);
        const image=canvas.toDataURL();
        const stream=canvas.captureStream(10);
        const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
        const chunks=[];
        const recorded=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));});
        recorder.start(); let count=0;
        const timer=setInterval(()=>{ctx.fillRect(count++,0,1,1);},50);
        await new Promise(r=>setTimeout(r,500)); recorder.stop();
        const video=URL.createObjectURL(await recorded); clearInterval(timer); stream.getTracks().forEach(t=>t.stop());
        window.__executionRenders=0;
        const ticket={assignmentId:1,ticketId:200,ticketNumber:'MT-DEMO-01',title:'بلاغ تجريبي — فحص صور وفيديو البلاغ',description:'Fixture only',teamId:1,teamName:'فريق الصيانة',warehouseName:'مخزن الفريق',stage:'action_required',sourceStatus:'in_progress',siteName:'موقع تجريبي',sectionName:'قسم تجريبي',reportMedia:[{url:image,type:'image',name:'صورة البلاغ'},{url:video,type:'video',name:'فيديو البلاغ'}]};
        createRoot(document.getElementById('root')).render(<TicketSequentialTasksView tickets={[ticket]} language='ar' renderExecution={()=>{window.__executionRenders++;return <div>Execution</div>}}/>);
      } main();`,
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: {
    "@": path.join(root, "client/src"),
    "@shared": path.join(root, "shared"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const out = path.join(root, "tmp/team-report-media-preview");
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r =>
    /^https?:/.test(r.url()) ? r.abort() : r.continue()
  );
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.setContent(
      `<html lang="ar" dir="rtl"><head><style>${css}</style></head><body><main id="root" style="padding:20px"></main></body></html>`
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('button[aria-label="عرض صورة البلاغ 1"]');
    assert.equal(await page.evaluate(() => window.__executionRenders), 0);
    await page.screenshot({ path: path.join(out, `card-${width}.png`) });
    await page.click('button[aria-label="عرض صورة البلاغ 1"]');
    await page.waitForSelector('[role="dialog"] img');
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[role="dialog"]')).opacity ===
        "1"
    );
    const dialog = await page.$('[role="dialog"]');
    const box = await dialog.boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.x + box.width <= width &&
        (width < 640 || box.width > 700),
      JSON.stringify(box)
    );
    await page.screenshot({ path: path.join(out, `image-${width}.png`) });
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find(b => b.textContent === "إغلاق")
        .click()
    );
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.click('button[aria-label="عرض فيديو البلاغ 2"]');
    await page.waitForSelector('[role="dialog"] video[controls]');
    await page.evaluate(async () => {
      const video = document.querySelector('[role="dialog"] video');
      video.muted = true;
      await video.play();
    });
    await page.screenshot({ path: path.join(out, `video-${width}.png`) });
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find(b => b.textContent === "إغلاق")
        .click()
    );
    await page.waitForSelector('[role="dialog"] video', { hidden: true });
    assert.equal(await page.evaluate(() => window.__executionRenders), 0);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile photo enlargement, video playback, close, no execution triggered."
  );
} finally {
  await browser.close();
}
