import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

// Real catalog UI; fake auth/RPC only. No server, credentials or database.
const root = process.cwd(),
  file = name => JSON.stringify(path.join(root, name).replaceAll("\\", "/"));
const fixture = `
import React from 'react';
import ar from ${file("client/src/i18n/ar.ts")};
import en from ${file("client/src/i18n/en.ts")};
import ur from ${file("client/src/i18n/ur.ts")};
const language=new URLSearchParams(location.search).get('lang')||'en';
document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';
const user={id:1,role:'admin',isActive:1};
// Latin stored values, even nameAr, make static Arabic leaks detectable.
const distinctCategories=new URLSearchParams(location.search).get('categoryNames')==='distinct';
const nodes=distinctCategories?[{id:1,parentId:null,code:'01',nameAr:'  الكهرباء العربية  ',nameEn:'  Electrical category EN  ',level:1,isActive:1},{id:2,parentId:1,code:'01-01',nameAr:'الإنارة العربية',nameEn:'Lighting category EN',level:2,isActive:1},{id:3,parentId:null,code:'02',nameAr:'تصنيف بلا ترجمة',nameEn:'',level:1,isActive:1},{id:4,parentId:null,code:'03',nameAr:'تصنيف باسم فارغ',nameEn:'   ',level:1,isActive:1}]:[{id:1,parentId:null,code:'01',nameAr:'Electrical',nameEn:'Electrical',level:1,isActive:1},{id:2,parentId:1,code:'01-01',nameAr:'Lighting',nameEn:'Lighting',level:2,isActive:1},{id:3,parentId:null,code:'02',nameAr:'Tools',nameEn:'Tools',level:1,isActive:1}];
const units=[{id:1,nameAr:'Piece',nameEn:'Piece',isActive:1},{id:2,nameAr:'Box',nameEn:'Box',isActive:0}];
const suppliers=[{id:1,nameAr:'Gulf Supplies',nameEn:'Gulf Supplies',phone:'0500000001',email:'supplier@example.invalid',country:'Saudi Arabia',contactName:'Sam',taxNumber:'300000000000001',commercialRegistration:'100001',address:'Riyadh',notes:'Fixture notes',isManufacturer:true,isActive:true}];
const supplierCandidates=[{id:21,extractedName:'New Supplier',invoiceNumber:'INV-21',taxNumber:'300000000000021',createdAt:'2026-11-24'}];
const items=[{id:11,code:'01-01-001',itemCode:'01-01-001',nameAr:'LED Fixture',nameEn:'LED Fixture',nameUr:'LED Fixture',descriptionAr:'Lamp fixture',descriptionEn:'Lamp fixture',nodeId:2,unit:'Piece',manufacturer:'Fixture maker',isActive:1,inventoryPageCount:1}];
const candidates=[31,32].map((id,i)=>({id,inventoryId:800+id,sourceReceiptId:900+id,sourceReceiptItemId:id,purchaseOrderId:100+id,purchaseOrderItemId:200+id,catalogSupplierId:1,supplierCandidateId:null,invoiceNumber:'INV-'+id,itemName:'New Lamp '+id,itemNameAr:'New Lamp '+id,itemNameEn:'New Lamp '+id,supplierItemCode:'SKU-'+id,purchaseUnit:'Piece',manufacturerBarcode:'123'+id,createdAt:'2026-11-'+(20+i),supplierNameAr:'Gulf Supplies',supplierNameEn:'Gulf Supplies',poNumber:'PR-MOCK-'+id}));
window.__reads=[];window.__mutations=[];window.__catalogCaptions={itemsTab:({ar,en,ur})[language].catalog.tabs.items,addItem:({ar,en,ur})[language].catalog.items.addNew};
function read(route,input={}){
 if(route==='inventory.bookPages')return {master:items[0],pages:[{id:801,itemName:'LED Fixture',warehouseId:1,isFrozen:0,quantity:3,unit:'Piece',movements:{incoming:4,outgoing:1},lots:[]}],nextId:null};
 if(route==='inventory.getItemSummary')return {itemName:'LED Fixture',description:'Fixture lamp',internalCode:'INV-MOCK',quantity:3,unit:'Piece',location:'Main warehouse',updatedAt:'2026-11-24',lastPurchasePrice:14};
 if(route==='inventory.getLedger')return [{transactionId:1,transactionType:'purchase',createdAt:'2026-11-24',inQty:4,outQty:0,balanceAfter:4,unit:'Piece',reference:'RCV-MOCK'}];
 if(route==='catalog.nodes.list')return nodes;
 if(route==='catalog.items.count')return {total:1};
 if(route==='catalog.suppliers.stats')return {active:1,total:1};
 if(route==='catalog.units.list')return units;
 if(route==='catalog.items.list')return items;
 if(route==='catalog.suppliers.list')return suppliers;
 if(route==='catalog.suppliers.candidates.listPending')return supplierCandidates;
 if(route==='catalog.itemCandidates.listPending')return candidates;
 if(route.endsWith('previewNextCode'))return {code:'01-01-002'};
 if(route==='catalogIntegrationTokens.list')return [{id:7,name:'Fixture integration',createdAt:'2026-11-24T08:00:00Z',revokedAt:null}];
 return [];
}
function response(route,input){
 if(route==='catalog.itemCandidates.suggestExisting')return {catalogMatches:[{catalogItemId:11,code:'01-01-001',nameAr:'LED Fixture',nameEn:'LED Fixture',unit:'Piece',score:92,reason:'catalog_name_exact',measurementStatus:'compatible'}],candidateMatches:[{candidateId:input.candidateId===31?32:31,itemName:'New Lamp peer',itemNameAr:'New Lamp peer',itemNameEn:'New Lamp peer',inventoryId:832,invoiceNumber:'INV-32',score:96,reason:'catalog_name_exact',measurementStatus:'compatible'}]};
 if(route==='catalog.importExport.importPreview')return {parsed:{taxonomyNodes:nodes,items},validation:{valid:true,errors:[],warnings:[{type:'fixture',message:'Fixture warning: check imported data.'}]}};
 if(route==='catalog.nodes.previewMove')return {plan:{oldRootCode:'01',newRootCode:'02-01',nodeChanges:[{id:1,nameAr:'Electrical',oldCode:'01',newCode:'02-01'}],itemChanges:[{id:11,nameAr:'LED Fixture',oldCode:'01-01-001',newCode:'02-01-001'}]},blockers:[],warnings:[]};
 return {};
}
const rpc=(parts=[])=>new Proxy(()=>{},{get(_,key){
 if(key==='useUtils')return()=>rpc();if(key==='invalidate')return async()=>{};
 if(key==='useQuery')return(input,options={})=>{const route=parts.join('.');if(options.enabled!==false)window.__reads.push({route,input});return {data:options.enabled===false?undefined:read(route,input),isLoading:false,isFetching:false,isError:false,error:null,refetch:async()=>({data:read(route,input)})};};
 if(key==='useMutation')return(options={})=>{const run=async input=>{const route=parts.join('.');window.__mutations.push({route,input});const result=response(route,input);await options.onSuccess?.(result,input);return result;};return {isPending:false,error:null,mutate:run,mutateAsync:run,reset:()=>{}};};
 return rpc([...parts,String(key)]);
}});
export const trpc=rpc();export const useAuth=()=>({user,authenticatedUser:user,loading:false});
export const useTranslation=()=>({language,dir:language==='en'?'ltr':'rtl',t:({ar,en,ur})[language]});export const useLanguage=useTranslation;
`;
const result = await build({
  stdin: {
    contents:
      "import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import Catalog from './client/src/pages/catalog/CatalogDashboard';createRoot(document.getElementById('root')).render(<div dir={document.documentElement.dir}><Catalog/><Toaster/></div>);",
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: {
    "@": path.join(root, "client/src"),
    "@shared": path.join(root, "shared"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-catalog",
      setup(p) {
        p.onResolve(
          {
            filter:
              /^@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext)$/,
          },
          () => ({ path: "fixture", namespace: "offline-catalog" })
        );
        p.onLoad({ filter: /.*/, namespace: "offline-catalog" }, () => ({
          contents: fixture,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const assets = "dist/public/assets",
  css = fs
    .readdirSync(assets)
    .filter(n => /^index-.*\.css$/.test(n))
    .map(n => fs.readFileSync(path.join(assets, n), "utf8"))
    .join("\n");
assert.ok(css, "Build the client first so QA uses application CSS.");
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
  css +
  '*{animation:none!important;transition:none!important}</style><div id="root"></div><script>' +
  result.outputFiles[0].text.replaceAll("</script", "<\\/script") +
  "</script>";
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.CATALOG_QA_CHROME ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
  ],
});
const screenshots = "tmp/catalog-localization";
fs.mkdirSync(screenshots, { recursive: true });
const failures = [],
  checked = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", r =>
    r.isNavigationRequest() &&
    r.url().startsWith("http://catalog-fixture.invalid/")
      ? r.respond({ status: 200, contentType: "text/html", body: html })
      : r.abort()
  );
  const goto = async (lang = "en", width = 1366, extraQuery = "") => {
    await page.setViewport({ width, height: 960 });
    await page.goto(
      "http://catalog-fixture.invalid/catalog?lang=" + lang + extraQuery
    );
    await page.waitForSelector("[role=tab]");
  };
  const click = async (label, selector = "button") => {
    const handle = await page.evaluateHandle(
      (label, selector) => {
        const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
        return (
          [...document.querySelectorAll(selector)].find(
            e =>
              norm(e.textContent || "") === norm(label) &&
              e.getBoundingClientRect().height > 0
          ) || null
        );
      },
      label,
      selector
    );
    const button = handle.asElement();
    assert.ok(button, "Missing visible control: " + label);
    if (selector === "[role=tab]") {
      await button.focus();
      await page.keyboard.press("Enter");
      await page.evaluate(() => window.scrollTo(0, 0));
    } else await button.click();
    await handle.dispose();
  };
  const title = async label => {
    assert.ok(
      await page.evaluate(label => {
        const button = [...document.querySelectorAll("button")].find(
          e => e.title === label && e.getBoundingClientRect().height > 0
        );
        if (!button) return false;
        button.click();
        return true;
      }, label),
      "Missing titled control: " + label
    );
  };
  const tab = async label => {
    await click(label, "[role=tab]");
    await page.waitForFunction(
      label =>
        [...document.querySelectorAll("[role=tab][data-state=active]")].some(
          e => e.textContent.trim().toLowerCase() === label.toLowerCase()
        ),
      {},
      label
    );
  };
  const close = async () => {
    await page.click("[role=dialog] [data-slot=dialog-close]");
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  };
  const clean = async label => {
    const state = await page.evaluate(() => ({
      text: document.body.innerText,
      attributes: [
        ...document.querySelectorAll("[placeholder],[title],[aria-label]"),
      ]
        .filter(
          e =>
            e.getBoundingClientRect().height > 0 &&
            getComputedStyle(e).visibility !== "hidden"
        )
        .flatMap(e =>
          ["placeholder", "title", "aria-label"].map(
            k => e.getAttribute(k) || ""
          )
        )
        .filter(x => /[\u0600-\u06ff]/u.test(x)),
      overflow: document.documentElement.scrollWidth - innerWidth,
      offenders: [...document.querySelectorAll("#root *")]
        .filter(e => e.getBoundingClientRect().right > innerWidth + 2)
        .slice(0, 8)
        .map(e => ({
          tag: e.tagName,
          role: e.getAttribute("role"),
          slot: e.getAttribute("data-slot"),
          class: e.className,
          width: e.getBoundingClientRect().width,
          right: e.getBoundingClientRect().right,
        })),
      dir: getComputedStyle(document.querySelector("#root > div")).direction,
      dialogDirections: [...document.querySelectorAll("[role=dialog]")].map(
        e => getComputedStyle(e).direction
      ),
    }));
    if (/[\u0600-\u06ff]/u.test(state.text) || state.attributes.length)
      failures.push({
        label,
        arabic: state.text.match(/[^\n]*[\u0600-\u06ff][^\n]*/gu),
        attributes: state.attributes,
      });
    if (state.overflow > 2)
      failures.push({
        label,
        overflow: state.overflow,
        offenders: state.offenders,
      });
    assert.equal(state.dir, "ltr");
    if (state.dialogDirections.some(dir => dir !== "ltr"))
      failures.push({ label, dialogDirections: state.dialogDirections });
    checked.push(label);
    console.log("Checked " + label);
  };
  if (process.argv.includes("--category-chooser")) {
    const selector = "[role=dialog] div.relative > button[type=button]";
    const rowLabels = () =>
      page.$$eval("[role=dialog] div[style] > span.text-sm.truncate", nodes =>
        nodes.map(node => node.textContent.trim())
      );
    const choose = async (label, expand = false) => {
      const handle = await page.evaluateHandle(
        (label, expand) => {
          const row = [
            ...document.querySelectorAll("[role=dialog] div[style]"),
          ].find(
            node =>
              node
                .querySelector(":scope > span.text-sm.truncate")
                ?.textContent.trim() === label
          );
          return expand
            ? row?.querySelector("button") || null
            : row?.querySelector(":scope > span.text-sm.truncate") || null;
        },
        label,
        expand
      );
      const target = handle.asElement();
      assert.ok(target, "Missing category row " + label);
      await target.click();
      await handle.dispose();
    };
    const selected = async (label, id) => {
      await page.waitForFunction(
        id =>
          window.__reads
            .filter(read => read.route === "catalog.items.previewNextCode")
            .at(-1)?.input.nodeId === id,
        {},
        id
      );
      assert.ok(
        (await page.$eval(selector, node => node.textContent)).includes(label)
      );
      assert.deepEqual(await page.evaluate(() => window.__mutations), []);
    };
    for (const lang of ["en", "ar", "ur"]) {
      await goto(lang, 1280, "&categoryNames=distinct");
      const captions = await page.evaluate(() => window.__catalogCaptions);
      await tab(captions.itemsTab);
      await click(captions.addItem);
      await page.waitForSelector("[role=dialog]");
      await page.click(selector);
      const roots = await rowLabels();
      assert.deepEqual(roots, [
        lang === "en" ? "Electrical category EN" : "الكهرباء العربية",
        "تصنيف بلا ترجمة",
        "تصنيف باسم فارغ",
      ]);
      await choose(
        lang === "en" ? "Electrical category EN" : "الكهرباء العربية",
        true
      );
      const childLabel =
        lang === "en" ? "Lighting category EN" : "الإنارة العربية";
      await page.waitForFunction(
        label =>
          [...document.querySelectorAll("[role=dialog] span")].some(
            node => node.textContent === label
          ),
        {},
        childLabel
      );
      const indentation = await page.evaluate(label => {
        const row = [
          ...document.querySelectorAll("[role=dialog] div[style]"),
        ].find(
          node =>
            node.querySelector(":scope > span.text-sm.truncate")
              ?.textContent === label
        );
        const css = getComputedStyle(row);
        return {
          inline: css.paddingInlineStart,
          edge:
            document.documentElement.dir === "ltr"
              ? css.paddingLeft
              : css.paddingRight,
        };
      }, childLabel);
      assert.deepEqual(indentation, { inline: "24px", edge: "24px" });
      await choose(childLabel);
      await selected(childLabel, 2);
      if (lang === "en") {
        for (const [label, id] of [
          ["تصنيف بلا ترجمة", 3],
          ["تصنيف باسم فارغ", 4],
        ]) {
          await page.click(selector);
          await choose(label);
          await selected(label, id);
        }
      }
      await page.screenshot({
        path: path.join(screenshots, "category-chooser-" + lang + ".png"),
        fullPage: false,
      });
      await close();
      console.log(
        "Checked category chooser " +
          lang +
          ": rows, selected label, canonical node ID, no writes, logical indentation"
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS focused category chooser: English names and trimmed Arabic fallbacks for empty/whitespace English; Arabic/Urdu preserved; selected IDs 2/3/4; no mutations or external network."
    );
  } else {
    await goto();
    assert.equal(await page.$$eval("[role=tab]", xs => xs.length), 7);
    for (const label of [
      "Overview",
      "Categories",
      "Items",
      "Units",
      "Suppliers",
      "New items",
      "Settings",
    ]) {
      await tab(label);
      await clean("EN tab " + label);
      assert.deepEqual(await page.evaluate(() => window.__mutations), []);
    }
    await tab("Categories");
    await click("Add Root Category");
    await page.waitForSelector("[role=dialog]");
    await clean("Add category");
    assert.equal(
      await page.$eval(
        "[role=dialog] input[dir=rtl]",
        e => getComputedStyle(e).direction
      ),
      "rtl"
    );
    await close();
    await title("Edit");
    await page.waitForSelector("[role=dialog]");
    await clean("Edit category");
    await close();
    await title("Move / restructure");
    await page.waitForSelector("[role=dialog]");
    await clean("Move category");
    await click("Preview numbering before applying");
    await page.waitForFunction(() =>
      document.body.innerText.includes("Previous code")
    );
    await clean("Move preview");
    await close();
    await tab("Units");
    await click("Add unit");
    await page.waitForSelector("[role=dialog]");
    await clean("Add unit");
    assert.equal(
      await page.$eval("[role=dialog] input[dir=rtl]", e =>
        e.getAttribute("dir")
      ),
      "rtl"
    );
    await close();
    await title("Edit");
    await page.waitForSelector("[role=dialog]");
    await clean("Edit unit");
    await close();
    await tab("Items");
    await click("Add Item");
    await page.waitForSelector("[role=dialog]");
    await clean("Add item");
    assert.equal(
      await page.$eval("[role=dialog] input[dir=rtl]", e =>
        e.getAttribute("dir")
      ),
      "rtl"
    );
    await close();
    await click("Edit");
    await page.waitForSelector("[role=dialog]");
    await clean("Edit item");
    await close();
    await click("View");
    await page.waitForSelector("[role=dialog]");
    await clean("View item");
    await close();
    await page.click('[aria-label="Item book details"]');
    await page.waitForFunction(() =>
      document.body.innerText.includes("Detailed movements and documents")
    );
    await clean("Item book pages");
    await click("Detailed movements and documents");
    await page.waitForSelector("[role=dialog]");
    await clean("Item book history");
    await tab("Receipt history");
    await clean("Book receipt history");
    await tab("Movement history");
    await clean("Book movement history");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
    await page.evaluate(() => {
      const input =
        document.querySelector('input[type=file][accept*=".xlsx"]') ||
        document.querySelector("input[type=file]");
      if (!input) throw Error("Import input missing");
      const d = new DataTransfer();
      d.items.add(
        new File(["fixture-only"], "fixture.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      input.files = d.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document
        .querySelector("[role=dialog]")
        ?.innerText.includes("Confirm import")
    );
    await clean("Import preview");
    await close();
    await tab("Suppliers");
    await click("Add supplier");
    await page.waitForSelector("[role=dialog]");
    await clean("Add supplier");
    assert.equal(
      await page.$eval("[role=dialog] input[dir=rtl]", e =>
        e.getAttribute("dir")
      ),
      "rtl"
    );
    await close();
    await click("Edit");
    await page.waitForSelector("[role=dialog]");
    await clean("Edit supplier");
    await close();
    await click("Link existing");
    await page.waitForSelector("[role=dialog]");
    await clean("Link supplier");
    await close();
    await tab("New items");
    await click("Check duplicates");
    await page.waitForFunction(() =>
      document.body.innerText.includes("Same item")
    );
    await clean("Duplicate suggestions");
    await click("Same item");
    await page.waitForSelector("[role=dialog]");
    await clean("Choose primary candidate");
    await close();
    await click("Link existing");
    await page.waitForSelector("[role=dialog]");
    await clean("Link item candidate");
    await close();
    await click("Approve new");
    await page.waitForSelector("[role=dialog]");
    await clean("Approve new candidate");
    await close();
    await tab("Items");
    await page.screenshot({
      path: path.join(screenshots, "en-desktop-items.png"),
      fullPage: false,
    });
    await page.setViewport({ width: 390, height: 844 });
    for (const label of [
      "Overview",
      "Categories",
      "Items",
      "Units",
      "Suppliers",
      "New items",
      "Settings",
    ]) {
      await tab(label);
      await clean("EN mobile " + label);
    }
    await tab("Items");
    await page.screenshot({
      path: path.join(screenshots, "en-mobile-items.png"),
      fullPage: false,
    });
    await click("Add Item");
    await page.waitForSelector("[role=dialog]");
    await clean("EN mobile add item");
    await page.screenshot({
      path: path.join(screenshots, "en-mobile-add-item.png"),
      fullPage: false,
    });
    await close();
    const allowed = [
      "catalog.nodes.previewMove",
      "catalog.importExport.importPreview",
      "catalog.itemCandidates.suggestExisting",
    ];
    const mutations = await page.evaluate(() => window.__mutations);
    assert.ok(mutations.length > 0);
    assert.deepEqual(
      mutations.filter(x => !allowed.includes(x.route)),
      [],
      "Unexpected data-changing operation"
    );
    await goto("ar");
    assert.equal(await page.$eval("html", e => e.dir), "rtl");
    assert.ok(
      await page.evaluate(() => document.body.innerText.includes("الكتالوج"))
    );
    await page.screenshot({
      path: path.join(screenshots, "ar-desktop-smoke.png"),
      fullPage: false,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          checked: checked.length,
          fixtureOnlyActions: mutations.map(x => x.route),
          screenshots,
          failures,
        },
        null,
        2
      )
    );
    assert.equal(
      failures.length,
      0,
      "English static text/layout failures above"
    );
    console.log(
      "PASS offline catalog browser: seven tabs; add/edit/move/item/unit/supplier/candidate/link/merge/import-preview dialogs; desktop/mobile LTR; Arabic smoke/input direction; blocked network; no data writes."
    );
  }
} catch (error) {
  console.error("Browser checks reached:", checked);
  console.error(
    "Recorded failures:",
    failures.map(({ label, overflow, arabic, attributes }) => ({
      label,
      overflow,
      arabic,
      attributes,
    }))
  );
  const pages = await browser.pages();
  await pages.at(-1)?.screenshot({
    path: path.join(screenshots, "failure.png"),
    fullPage: false,
  });
  throw error;
} finally {
  await browser.close();
}
