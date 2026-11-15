import { afterEach, describe, expect, it, vi } from "vitest";
const qr=vi.hoisted(()=>({toDataURL:vi.fn(async()=>"data:image/png;base64,AA==")}));
vi.mock("qrcode",()=>({default:qr}));
import { inventoryLabelsHtml, printInventoryLabels } from "../../client/src/lib/printInventoryLabels";
import fs from "node:fs";
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const item={itemName:"فلتر <script>bad()</script>",lotCode:"LOT-2026-00001",trackingToken:"CMMS-LOT-canonical",quantity:2,unit:"حبة"};
describe("Standalone inventory label printing",()=>{
  it("prints only the code and name when inventory requests a simplified lot label",()=>{
    const label={...item,sourceType:"opening_balance",qrImage:"data:image/png;base64,AA=="};
    const html=inventoryLabelsHtml([label],{hideLotDetails:true});
    expect(html).toContain(item.lotCode);expect(html).toContain("فلتر");expect(html).toContain('alt="QR"');
    expect(html).not.toContain('<div class="meta">');expect(html).not.toContain("رصيد افتتاحي");
    expect(inventoryLabelsHtml([label])).toContain("رصيد افتتاحي");
  });
  it.each([1,2,10])("renders %i labels with breaks only between them",count=>{
    const html=inventoryLabelsHtml(Array.from({length:count},()=>({...item,qrImage:"data:image/png;base64,AA=="})));
    expect(html.match(/<section /g)).toHaveLength(count);expect(html).toContain("size: 58mm 38mm; margin: 0");expect(html).toContain(".label + .label");expect(html).not.toContain("break-after: always");expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");
  });
  it("opens synchronously, waits for QR images, and prints only the independent document",async()=>{
    const events:string[]=[];const close=vi.fn();const print=vi.fn(()=>events.push("print"));
    const target:any={document:{open:vi.fn(),write:vi.fn(),close:vi.fn(),images:[{decode:async()=>{events.push("decoded");}}]},focus:vi.fn(),print,close,addEventListener:vi.fn()};
    const open=vi.fn(()=>{events.push("open");return target;});vi.stubGlobal("window",{open});
    const work=printInventoryLabels([item]);expect(events).toEqual(["open"]);await work;
    expect(qr.toDataURL).toHaveBeenCalledWith(item.trackingToken,expect.any(Object));expect(events).toEqual(["open","decoded","print"]);expect(target.opener).toBeNull();expect(target.document.write.mock.calls[0][0]).toContain("LOT-2026-00001");expect(close).not.toHaveBeenCalled();
  });
  it("reports blocked popups without attempting to print the application",async()=>{
    vi.stubGlobal("window",{open:()=>null});await expect(printInventoryLabels([item])).rejects.toThrow("النوافذ المنبثقة");
  });
  it("routes all three print entry points through the same helper",()=>{
    for(const file of ["client/src/components/inventory/LotLabelsPrintScreen.tsx","client/src/pages/inventory/WarehouseReceiveV2.tsx","client/src/pages/inventory/InventoryStandaloneReceive.tsx"]){const source=fs.readFileSync(file,"utf8");expect(source).toContain("printInventoryLabels(items)");const screen=source.slice(source.lastIndexOf(file.includes("LotLabels")?"export default function":"function BarcodesPrintScreen"));expect(screen).not.toContain("window.print()");expect(screen).not.toContain("visibility: hidden");}
  });
});
