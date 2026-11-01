import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { router } from "../routers/_shared/procedures";

const f = vi.hoisted(() => ({
  orders: [] as any[], items: [] as any[], receipts: [] as any[], lines: [] as any[],
  lots: [] as any[], movements: [] as any[], inventory: [] as any[], reads: [] as any[],
  failLot: false, changeAtLock: false, tx: null as any,
}));
// No environment, connection pool, OCR, network or live DB is loaded.
vi.mock("../_core/db/client", () => ({ getDb: async () => { throw Error("live database forbidden"); } }));
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("../_core/ai-response-cache", () => ({ withAiResponseCache: vi.fn() }));
vi.mock("../services/ocr/invoiceOcr.service", () => ({ analyzeInvoiceFromUrl: vi.fn(), analyzeInvoiceFromBase64: vi.fn() }));
vi.mock("../_core/catalog-unit-governance", () => ({ getActiveCatalogUnitCanonicalName: async (unit: string) => unit }));
vi.mock("../_core/inventory-lots", () => ({
  isInventoryLotsEnabled: () => true,
  createReceiptInventoryLot: async (data: any) => {
    if (f.failLot && f.lots.length === 1) throw Error("second lot failed");
    f.lots.push(data);
    return { lotId: f.lots.length, lotCode: `LOT-${f.lots.length}`, trackingToken: `TOKEN-${f.lots.length}` };
  },
}));
vi.mock("../_core/db", () => ({
  getDb: async () => f.tx,
  getPurchaseOrderById: async (id: number) => f.orders.find(order => order.id === id),
  getPOItems: async (id: number) => f.items.filter(item => item.purchaseOrderId === id),
  checkDuplicateInvoice: async () => f.receipts.length ? f.receipts[0] : null,
  withTransaction: async (work: any) => {
    const before = structuredClone({ orders:f.orders,items:f.items,receipts:f.receipts,lines:f.lines,lots:f.lots,movements:f.movements,inventory:f.inventory });
    try { return await work(f.tx); } catch (error) { Object.assign(f, before); throw error; }
  },
  getNextReceiptNumber: async () => "RCV-TEST-1",
  createWarehouseReceiptV2: async (data: any) => { f.receipts.push({ ...data, id: 1 }); return 1; },
  createWarehouseReceiptItem: async (data: any) => { f.lines.push(data); return f.lines.length; },
  getInventoryMatchesByCatalogItemAndWarehouse: async () => [],
  getNextInventoryCode: async () => `INV-${f.inventory.length + 1}`,
  createInventoryItemV2: async (data: any) => { const id=f.inventory.length+1; f.inventory.push({...data,id}); return id; },
  addInventoryTransactionV2: async (data: any) => { f.movements.push(data); },
  updatePOItem: async (id: number, data: any) => { Object.assign(f.items.find(item => item.id === id), data); },
  updatePurchaseOrder: async (id: number, data: any) => { Object.assign(f.orders.find(order => order.id === id), data); },
  getManagerUsers: async () => [], createAuditLog: async () => 1,
  getInventoryItemById: async (id: number) => f.inventory.find(item => item.id === id),
}));
import { receiptsV2Router } from "../routers/inventory/receipts.v2.router";
const dialect = new MySqlDialect();
function txFixture() {
  return {
    // The existing supplier-return gate probes the database name even for an
    // ordinary receipt. Keep this fixture outside that unrelated workflow.
    execute: async (query:any) => {
      if(dialect.sqlToQuery(query).sql.includes("SELECT DATABASE()")) return [[{databaseName:"isolated_receipt_fixture"}]];
      throw Error("unexpected raw query in isolated grouped receipt fixture");
    },
    select(fields: any) {
      const keys=Object.keys(fields); const read:any={keys,params:[],locked:false}; f.reads.push(read);
      const q:any={ from:()=>q, innerJoin:()=>q, orderBy:()=>q, limit:()=>q,
        where:(sql:any)=>{ read.params=dialect.sqlToQuery(sql).params; return q; },
        for:()=>{read.locked=true; if(f.changeAtLock && keys.includes('purchaseOrderId')) f.items[1].supplierInvoiceNumber='CHANGED-AFTER-READ'; return q;},
        then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
          if (keys.includes("poNumber")) return f.orders.filter(order=>read.params.includes(order.id));
          if (keys.includes("itemId")) return f.lines.filter(line=>f.receipts.some(receipt=>receipt.status==='confirmed' && receipt.id===line.receiptId)).map(line=>({itemId:line.purchaseOrderItemId}));
          if (keys.includes("purchaseOrderId")) return f.items.filter(item=> read.locked
            ? read.params.includes(item.id) && read.params.includes(item.purchaseOrderId)
            : read.params.includes(item.purchaseOrderId) && item.status==='delivered_to_warehouse');
          if (keys.includes("isActive")) return [{id:100,isActive:1}];
          if (keys.includes("unit")) return [{unit:"قطعة"}];
          if (keys.join(',')==='id') return [{id:1}];
          throw Error(`unexpected read ${keys}`);
        }).then(resolve,reject),
      }; return q;
    },
    insert:()=>({values:async()=>[{insertId:1}]}),
    update:()=>({set:()=>({where:async()=>[]})}),
  };
}
const api=router({warehouseReceiptsV2:receiptsV2Router});
const caller=(role='warehouse',isActive=1)=>api.createCaller({user:{id:50,role,isActive,name:'UAT'}} as any);
const input=()=>({purchaseOrderId:1,purchaseOrderIds:[1,2],sourceInvoiceNumber:'SAME-INVOICE',invoiceNumber:'SAME-INVOICE',vendorName:'UAT supplier',isNewSupplier:true,
  items:[11,22].map(id=>({purchaseOrderItemId:id,linkedItemId:100,itemName:`item-${id}`,receivedQuantity:1,purchaseUnit:'قطعة',issueUnit:'قطعة',conversionFactor:1,unitCost:'1',taxRate:15,taxAmount:'0.15',lineTotal:'1.15'}))});
beforeEach(()=>{
  f.orders=[{id:1,poNumber:'PR-A',status:'received'},{id:2,poNumber:'PR-B',status:'received'}];
  f.items=[{id:11,purchaseOrderId:1,status:'delivered_to_warehouse',supplierInvoiceNumber:'SAME-INVOICE',catalogItemId:100,unit:'قطعة',quantity:1},{id:22,purchaseOrderId:2,status:'delivered_to_warehouse',supplierInvoiceNumber:'SAME-INVOICE',catalogItemId:100,unit:'قطعة',quantity:1}];
  f.receipts=[];f.lines=[];f.lots=[];f.movements=[];f.inventory=[];f.reads=[];f.failLot=false;f.changeAtLock=false;f.tx=txFixture();
});
describe('real grouped receipt writer on disposable transactional data',()=>{
  it('saves both source links, lots and movements in one invoice without rewriting their parent',async()=>{
    const saved=await caller().warehouseReceiptsV2.receiveFromPurchaseV2(input());
    expect(saved.lotLabels).toHaveLength(2);
    expect(f.receipts).toHaveLength(1);
    expect(f.lines.map(line=>line.purchaseOrderItemId)).toEqual([11,22]);
    expect(f.lots.map(lot=>[lot.purchaseOrderId,lot.purchaseOrderItemId,lot.issueQuantity,lot.issueUnitCost])).toEqual([[1,11,1,1],[2,22,1,1]]);
    expect(f.movements.map(move=>[move.purchaseOrderItemId,move.lotId,move.totalCost])).toEqual([[11,1,'1.00'],[22,2,'1.00']]);
    expect(f.movements.map(move=>move.reason)).toEqual([expect.stringContaining('PR-A'),expect.stringContaining('PR-B')]);
    await expect(caller().warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toMatchObject({code:'CONFLICT'});
    expect(f.receipts).toHaveLength(1);
  });
  it('rolls back every receipt, item and movement when the second lot fails',async()=>{
    f.failLot=true;
    await expect(caller().warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toThrow('second lot failed');
    expect([f.receipts.length,f.lines.length,f.lots.length,f.movements.length,f.inventory.length]).toEqual([0,0,0,0,0]);
  });
  it('retains single-PO receipt behavior and conversion costing',async()=>{
    const data=input();
    const single:any={...data,purchaseOrderIds:undefined,sourceInvoiceNumber:undefined,
      items:[{...data.items[0],purchaseUnit:'كرتون',conversionFactor:10,unitCost:'300',taxAmount:'45',lineTotal:'345'}]};
    await caller().warehouseReceiptsV2.receiveFromPurchaseV2(single);
    expect(f.lots[0]).toMatchObject({purchaseOrderId:1,purchaseOrderItemId:11,issueQuantity:10,issueUnitCost:30,purchaseUnitCost:300});
    expect(f.movements[0]).toMatchObject({quantity:10,unitCost:'30.0000',totalCost:'300.00'});
  });
  it('does not use the receipt header to overwrite an extra item source',async()=>{
    const data=input();
    const extra={...data.items[0],purchaseOrderItemId:undefined,itemName:'invoice extra'};
    await caller().warehouseReceiptsV2.receiveFromPurchaseV2({...data,items:[...data.items,extra]} as any);
    expect(f.lines[2].purchaseOrderItemId).toBeUndefined();
    expect(f.lots[1]).toMatchObject({purchaseOrderId:2,purchaseOrderItemId:22});
  });
  it.each(['delegate','accountant','senior_management','technician','food_warehouse_manager','food_warehouse_assistant'])('%s cannot bypass the receipt API',async role=>{
    await expect(caller(role).warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.receipts).toHaveLength(0);
  });
  it.each(['admin','owner'])('%s retains existing receipt access',async role=>{
    await caller(role).warehouseReceiptsV2.receiveFromPurchaseV2(input());
    expect(f.lines).toHaveLength(2);
  });
  it('disabled warehouse cannot write',async()=>{
    await expect(caller('warehouse',0).warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.reads).toHaveLength(0);
  });
  it('rechecks the invoice under lock after the earlier read has succeeded',async()=>{
    f.changeAtLock=true;
    await expect(caller().warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect(f.receipts).toHaveLength(0);
    expect(f.movements).toHaveLength(0);
  });
  it.each(['parent','invoice','status'])('rejects changed %s membership before inventory writes',async change=>{
    if(change==='parent') f.items[1].purchaseOrderId=3;
    if(change==='invoice') f.items[1].supplierInvoiceNumber='FOREIGN';
    if(change==='status') f.items[1].status='approved';
    await expect(caller().warehouseReceiptsV2.receiveFromPurchaseV2(input())).rejects.toMatchObject({code:'BAD_REQUEST'});
    expect(f.receipts).toHaveLength(0);
  });
});
