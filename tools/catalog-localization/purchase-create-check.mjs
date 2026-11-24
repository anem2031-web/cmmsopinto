import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

// Actual purchase page, chooser, catalog form and Radix dialogs. All I/O is inert.
const root = process.cwd(),
  file = name => JSON.stringify(path.join(root, name).replaceAll("\\", "/"));
const fixture = `
import React from 'react';
import ar from ${file("client/src/i18n/ar.ts")};
import en from ${file("client/src/i18n/en.ts")};
import ur from ${file("client/src/i18n/ur.ts")};
import {getCatalogItemsText} from ${file("client/src/i18n/catalogItems.ts")};
const params=new URLSearchParams(location.search),language=params.get('lang')||'en',role=params.get('role')||'construction_procurement_manager';
const user={id:1,role,isActive:params.get('active')==='0'?0:1},authenticatedUser={...user,role:params.get('actualRole')||role};
const t=({ar,en,ur})[language],text=getCatalogItemsText(language);
document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';
window.__reads=[];window.__mutations=[];window.__uploads=[];window.__invalidations=[];window.__failCatalog=false;window.__failUpload=false;
window.__labels={fromCatalog:t.workflow.purchase.fromCatalog,pickerTitle:t.workflow.purchase.catalogPickItem,add:t.catalog.items.addNew,save:t.common.save,cancel:t.common.cancel,search:t.common.searchPlaceholder,selectCategory:text.selectCategory,nameAr:text.itemNameExample,nameEn:text.itemNameEnglishExample,justification:t.purchaseOrders.justification};
const nodes=[{id:1,parentId:null,code:'01',nameAr:'Electrical',nameEn:'Electrical',level:1,isActive:1},{id:2,parentId:1,code:'01-01',nameAr:'Lighting',nameEn:'Lighting',level:2,isActive:1},{id:3,parentId:null,code:'02',nameAr:'Other category',nameEn:'Other category',level:1,isActive:1}];
const units=[{id:1,nameAr:'Piece',nameEn:'Piece',isActive:1}],empty=[],items=[{id:11,nodeId:2,code:'01-01-001',nameAr:'Existing LED',nameEn:'Existing LED',descriptionAr:'Original item',descriptionEn:'Original item',unit:'Piece',isActive:1}];
const sites=[{id:3,name:'Fixture site',nameEn:'Fixture site'}],sections=[{id:5,siteId:3,name:'Fixture section',nameEn:'Fixture section'}],categories=[{id:6,nameAr:'Fixture category',nameEn:'Fixture category',isActive:1}];
const read=(route,input={})=>{
 if(route==='catalog.nodes.list')return nodes;if(route==='catalog.units.list')return units;
 if(route==='catalog.items.list')return items.filter(item=>(!input.search||(item.nameAr+' '+item.nameEn+' '+item.code).toLowerCase().includes(input.search.toLowerCase()))&&(!input.nodeIds||input.nodeIds.includes(item.nodeId)));
 if(route==='catalog.items.count')return {total:items.length};
 if(route==='catalog.items.previewNextCode'){const n=nodes.find(n=>n.id===input.nodeId);return {code:(n?.code||'01-01')+'-002',nodeCode:n?.code,nodeId:input.nodeId};}
 if(route==='sites.list')return sites;if(route==='sections.list')return sections;if(route==='centerCategories.list')return categories;
 if(route==='inventory.catalogStock')return empty;
 if(route.endsWith('.getById')||route==='purchaseOrders.getById')return undefined;
 return empty;
};
const listeners=new Set();let revision=0;const changed=()=>{revision++;for(const notify of listeners)notify(revision);};
const rpc=(parts=[])=>new Proxy(()=>{},{get(_,key){
 if(key==='useUtils')return()=>rpc();
 if(key==='invalidate')return async input=>{window.__invalidations.push({route:parts.join('.'),input});changed();};
 if(key==='useQuery')return(input,options={})=>{
  const [version,setVersion]=React.useState(revision);React.useEffect(()=>{listeners.add(setVersion);return()=>listeners.delete(setVersion);},[]);
  const route=parts.join('.'),fingerprint=JSON.stringify(input);
  const data=React.useMemo(()=>{if(options.enabled===false)return undefined;window.__reads.push({route,input});return read(route,input);},[route,fingerprint,version,options.enabled]);
  return {data,isLoading:false,isFetching:false,isError:false,error:null,refetch:async()=>{changed();return {data:read(route,input)};}};
 };
 if(key==='useMutation')return(options={})=>{
  const [pending,setPending]=React.useState(false),route=parts.join('.');
  const run=async input=>{setPending(true);window.__mutations.push({route,input});
   try{if(route==='catalog.items.create'&&window.__failCatalog){window.__failCatalog=false;throw new Error('Fixture catalog save rejected');}
    let result={};if(route==='catalog.items.create'){const id=100+items.length;items.push({...input,id,code:input.code||nodes.find(n=>n.id===input.nodeId).code+'-002',isActive:1,primaryImageUrl:'/created-fixture.png'});result=id;}
    await options.onSuccess?.(result,input);return result;
   }catch(error){await options.onError?.(error,input);throw error;}finally{setPending(false);}
  };return {isPending:pending,error:null,mutate:input=>void run(input).catch(()=>{}),mutateAsync:run,reset:()=>{}};
 };
 return rpc([...parts,String(key)]);
}});
class UploadFixture{
 upload={};status=0;responseText='';
 open(method,url){this.method=method;this.url=url;}
 send(form){const file=form.get('file');window.__uploads.push({method:this.method,url:this.url,fileName:file?.name,size:file?.size});setTimeout(()=>{
  this.upload.onprogress?.({lengthComputable:true,loaded:1,total:1});
  this.status=window.__failUpload?500:200;window.__failUpload=false;
  this.responseText=this.status===200?JSON.stringify({url:'/created-fixture.png',fileKey:'cmms/uploads/u-1/created-fixture.webp'}):JSON.stringify({error:'Fixture image upload rejected'});
  this.onload?.();
 },25);}
}
window.XMLHttpRequest=UploadFixture;
export const trpc=rpc();
export const useAuth=()=>({user,authenticatedUser,loading:false});
export const useTranslation=()=>({language,dir:language==='en'?'ltr':'rtl',isRTL:language!=='en',t});
export const useLanguage=useTranslation;
`;
const bundle = await build({
  stdin: {
    contents:
      "import React from'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import CreatePurchaseOrder from './client/src/pages/purchase/CreatePurchaseOrder';createRoot(document.getElementById('root')).render(<><CreatePurchaseOrder/><Toaster/></>);",
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
      name: "offline-purchase-create",
      setup(p) {
        p.onResolve(
          {
            filter:
              /^@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext)$/,
          },
          () => ({ path: "fixture", namespace: "offline-purchase-create" })
        );
        p.onLoad(
          { filter: /.*/, namespace: "offline-purchase-create" },
          () => ({ contents: fixture, loader: "tsx", resolveDir: root })
        );
      },
    },
  ],
});
const assetDirectory = path.join(root, "dist/public/assets");
const css = fs
  .readdirSync(assetDirectory)
  .filter(name => /^index-.*\.css$/.test(name))
  .map(name => fs.readFileSync(path.join(assetDirectory, name), "utf8"))
  .join("\n");
assert.ok(css, "Build the client first for application CSS.");
const html =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
  css +
  '*{animation:none!important;transition:none!important}</style><div id="root"></div><script>' +
  bundle.outputFiles[0].text.replaceAll("</script", "<\\/script") +
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
const screenshots = path.join(root, "tmp/catalog-localization/purchase-create");
fs.mkdirSync(screenshots, { recursive: true });
const checked = [],
  errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (
      request.isNavigationRequest() &&
      request.url().startsWith("http://purchase-catalog-fixture.invalid/")
    )
      return request.respond({
        status: 200,
        contentType: "text/html",
        body: html,
      });
    if (request.url().startsWith("data:") || request.url().startsWith("blob:"))
      return request.continue();
    return request.abort();
  });
  const goto = async (extra = "", width = 1366) => {
    await page.setViewport({ width, height: 960 });
    await page.goto(
      "http://purchase-catalog-fixture.invalid/purchase-orders/new?" + extra
    );
    await page.waitForSelector("#purchase-item-0-quantity");
  };
  const click = async (label, scope = "body") => {
    const handle = await page.evaluateHandle(
      (label, scope) =>
        [...document.querySelectorAll(scope + " button")].find(
          button =>
            button.textContent.replace(/\s+/g, " ").trim() === label &&
            button.getBoundingClientRect().height > 0
        ) || null,
      label,
      scope
    );
    assert.ok(handle.asElement(), "Missing visible button: " + label);
    await handle.asElement().click();
    await handle.dispose();
  };
  const labels = () => page.evaluate(() => window.__labels);
  const fill = async (selector, value) => {
    const handle = await page.$(selector);
    assert.ok(handle, "Missing field " + selector);
    await handle.click({ clickCount: 3 });
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await handle.type(value);
  };
  const openPicker = async () => {
    await click((await labels()).fromCatalog);
    await page.waitForSelector("[role=dialog]");
    await page.waitForFunction(() =>
      document.querySelector("[role=dialog] input")
    );
  };
  const createButton = async () =>
    page.evaluateHandle(
      () =>
        [
          ...document.querySelectorAll(
            "[role=dialog] [data-slot=dialog-header] button"
          ),
        ].find(button => button.getBoundingClientRect().height > 0) || null
    );
  const startCreate = async () => {
    const handle = await createButton();
    assert.ok(handle.asElement(), "Missing inline create action");
    await handle.asElement().click();
    await handle.dispose();
    await page.waitForSelector("[role=dialog] input[type=file]");
  };
  const oneDialog = async () => {
    assert.equal(
      await page.$$eval("[role=dialog]", nodes => nodes.length),
      1,
      "Only one active modal"
    );
    assert.ok(
      await page.evaluate(() =>
        document
          .querySelector("[role=dialog]")
          ?.contains(document.activeElement)
      ),
      "Focus stays inside the current modal"
    );
  };
  const draft = () =>
    page.evaluate(() => ({
      quantity: document.querySelector("#purchase-item-0-quantity")?.value,
      itemNotes: document.querySelector('textarea[maxlength="200"]')?.value,
      orderNotes: [...document.querySelectorAll("textarea")].find(
        node => node.placeholder === window.__labels.justification
      )?.value,
    }));
  const prepare = async () => {
    await fill("#purchase-item-0-quantity", "7");
    await fill('textarea[maxlength="200"]', "PO item draft memo");
    const placeholder = (await labels()).justification;
    await fill(
      "textarea[placeholder=" + JSON.stringify(placeholder) + "]",
      "PO order draft memo"
    );
    await openPicker();
    await fill("[role=dialog] input", "LED");
    await page.evaluate(() => {
      const category = [
        ...document.querySelectorAll("[role=dialog] div.cursor-pointer"),
      ].find(node => node.textContent.includes("Electrical"));
      category?.click();
    });
    await page.waitForFunction(() =>
      window.__reads.some(
        read =>
          read.route === "catalog.items.list" &&
          read.input.search === "LED" &&
          read.input.nodeIds?.includes(1)
      )
    );
  };
  const verifyDraft = async () =>
    assert.deepEqual(await draft(), {
      quantity: "7",
      itemNotes: "PO item draft memo",
      orderNotes: "PO order draft memo",
    });
  const fillCatalog = async () => {
    const captions = await labels();
    await click(captions.selectCategory, "[role=dialog]");
    await page.evaluate(() => {
      const row = [
        ...document.querySelectorAll("[role=dialog] div.cursor-pointer"),
      ].find(node => node.textContent.includes("Electrical"));
      if (!row) throw Error("Missing form category");
      row.querySelector("button").click();
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[role=dialog] div.cursor-pointer")].some(
        node => node.textContent.includes("Lighting")
      )
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("[role=dialog] div.cursor-pointer")]
        .find(node => node.textContent.includes("Lighting"))
        .click()
    );
    const fields = await page.$$("[role=dialog] input");
    const nameInputs = [];
    for (const field of fields) {
      const placeholder = await field.evaluate(node => node.placeholder);
      if (placeholder === captions.nameAr || placeholder === captions.nameEn)
        nameInputs.push(field);
    }
    assert.equal(nameInputs.length, 2);
    await nameInputs[0].type("Inline catalog AR");
    await nameInputs[1].type("Inline New Fixture");
    await page.select("[role=dialog] select", "Piece");
    const upload = await page.$("[role=dialog] input[type=file]");
    await upload.uploadFile(path.join(screenshots, "photo.png"));
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[role=dialog] input")].some(
        node => node.value === "01-01-002"
      )
    );
  };
  const assertNoPO = async () => {
    const writes = await page.evaluate(() => window.__mutations);
    assert.ok(
      writes.every(write => write.route === "catalog.items.create"),
      "No purchase or unrelated mutation"
    );
    assert.ok(
      page.url().includes("/purchase-orders/new?"),
      "Purchase route remains unchanged"
    );
  };
  fs.writeFileSync(
    path.join(screenshots, "photo.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+6ymQAAAAASUVORK5CYII=",
      "base64"
    )
  );
  for (const role of ["construction_procurement_manager", "admin", "owner"]) {
    await goto("role=" + role);
    await openPicker();
    assert.ok(
      (await createButton()).asElement(),
      role + " can open inline creation"
    );
    checked.push("role:" + role);
  }
  for (const extra of [
    "role=it_manager",
    "role=maintenance_manager",
    "role=warehouse",
    "role=delegate",
    "role=senior_management",
    "role=construction_procurement_manager&active=0",
    "role=admin&actualRole=observer",
  ]) {
    await goto(extra);
    await openPicker();
    assert.equal(
      (await createButton()).asElement(),
      null,
      extra + " does not gain inline creation"
    );
    checked.push("denied:" + extra);
  }
  for (const lang of ["en", "ar"]) {
    for (const width of [1366, 390]) {
      await goto("lang=" + lang, width);
      await openPicker();
      await oneDialog();
      const geometry = await page.evaluate(() => {
        const title = document
            .querySelector("[role=dialog] [data-slot=dialog-title]")
            .getBoundingClientRect(),
          button = [
            ...document.querySelectorAll(
              "[role=dialog] [data-slot=dialog-header] button"
            ),
          ][0].getBoundingClientRect(),
          dialog = document.querySelector("[role=dialog]"),
          itemName = [...dialog.querySelectorAll("p")].find(
            node => node.textContent.trim() === "Existing LED"
          );
        return {
          dialogWidth: dialog.getBoundingClientRect().width,
          itemNameWidth: itemName?.getBoundingClientRect().width ?? 0,
          title: {
            left: title.left,
            right: title.right,
            y: title.y,
            height: title.height,
          },
          button: {
            left: button.left,
            right: button.right,
            y: button.y,
            height: button.height,
          },
          dir: getComputedStyle(dialog).direction,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.equal(geometry.dir, lang === "en" ? "ltr" : "rtl");
      assert.ok(
        Math.abs(
          geometry.title.y +
            geometry.title.height / 2 -
            (geometry.button.y + geometry.button.height / 2)
        ) < 12,
        "Title and action share a row"
      );
      assert.ok(
        lang === "en"
          ? geometry.button.left >= geometry.title.right - 2
          : geometry.button.right <= geometry.title.left + 2,
        "Header action follows text direction"
      );
      assert.ok(geometry.overflow <= 2, "No horizontal viewport overflow");
      if (width >= 700)
        assert.ok(
          geometry.dialogWidth <= 700,
          "Desktop chooser retains its compact width"
        );
      else
        assert.ok(
          geometry.itemNameWidth > 0,
          "Mobile chooser keeps a visible item name column"
        );
      await page.screenshot({
        path: path.join(screenshots, "picker-" + lang + "-" + width + ".png"),
        fullPage: false,
      });
      checked.push("layout:" + lang + ":" + width);
    }
  }
  await goto();
  await prepare();
  const originalUrl = page.url();
  await startCreate();
  await oneDialog();
  await verifyDraft();
  await page.click("[role=dialog] [data-slot=dialog-close]");
  await page.waitForSelector("[role=dialog] input");
  await oneDialog();
  await verifyDraft();
  assert.equal(
    await page.$eval("[role=dialog] input", node => node.value),
    "LED"
  );
  const restoredFilter = await page.evaluate(
    () =>
      window.__reads
        .filter(
          read => read.route === "catalog.items.list" && read.input.limit === 80
        )
        .at(-1)?.input
  );
  assert.deepEqual(
    restoredFilter.nodeIds,
    [1, 2],
    "Cancel preserves chooser category"
  );
  assert.equal(page.url(), originalUrl);
  checked.push("cancel:retains-PO-and-picker");
  await startCreate();
  await fillCatalog();
  await page.evaluate(() => {
    window.__failUpload = true;
  });
  await click((await labels()).save, "[role=dialog]");
  await page.waitForFunction(() =>
    document.body.innerText.includes("Fixture image upload rejected")
  );
  await oneDialog();
  await verifyDraft();
  assert.equal(
    await page.evaluate(() => window.__mutations.length),
    0,
    "Upload failure never creates catalog item"
  );
  checked.push("upload-failure:stays-open");
  await page.evaluate(() => {
    window.__failCatalog = true;
  });
  await click((await labels()).save, "[role=dialog]");
  await page.waitForFunction(() =>
    document.body.innerText.includes("Fixture catalog save rejected")
  );
  await oneDialog();
  await verifyDraft();
  checked.push("save-failure:stays-open");
  await click((await labels()).save, "[role=dialog]");
  await page.waitForFunction(
    () =>
      document.querySelector("[role=dialog] input") &&
      !document.querySelector("[role=dialog] input[type=file]")
  );
  await oneDialog();
  await verifyDraft();
  assert.equal(
    await page.$eval("[role=dialog] input", node => node.value),
    "LED",
    "Success preserves picker search"
  );
  const recorded = await page.evaluate(() => ({
    writes: window.__mutations,
    invalidations: window.__invalidations,
    reads: window.__reads,
  }));
  const successful = recorded.writes.at(-1);
  assert.equal(successful.route, "catalog.items.create");
  assert.equal(successful.input.nodeId, 2);
  assert.equal(successful.input.nameEn, "Inline New Fixture");
  assert.equal(successful.input.unit, "Piece");
  assert.equal(
    successful.input.image.fileKey,
    "cmms/uploads/u-1/created-fixture.webp"
  );
  assert.equal(
    successful.input.code,
    undefined,
    "Original automatic-code path preserved"
  );
  assert.ok(
    recorded.invalidations.some(row => row.route === "catalog.items.list")
  );
  assert.ok(
    recorded.invalidations.some(row => row.route === "catalog.items.count")
  );
  assert.ok(
    recorded.reads.some(
      row =>
        row.route === "catalog.items.list" &&
        row.input.search === "LED" &&
        !row.input.nodeIds
    ),
    "New creation clears chooser category so new item is discoverable"
  );
  await fill("[role=dialog] input", "Inline New Fixture");
  await page.waitForFunction(() =>
    document
      .querySelector("[role=dialog]")
      ?.textContent.includes("Inline New Fixture")
  );
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("[role=dialog] button")].find(
      node => node.textContent.includes("Inline New Fixture")
    );
    if (!button) throw Error("Created catalog result missing");
    button.click();
  });
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  assert.equal(
    await page.$eval("#purchase-item-0-itemName", node => node.value),
    "Inline New Fixture"
  );
  await verifyDraft();
  await assertNoPO();
  checked.push("success:existing-API-image-code-invalidation-search-select");
  assert.deepEqual(errors, [], "No browser runtime errors");
  fs.writeFileSync(
    path.join(screenshots, "result.json"),
    JSON.stringify({ checked, errors }, null, 2)
  );
  console.log(
    JSON.stringify(
      { passed: checked.length, checked, artifacts: screenshots },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
