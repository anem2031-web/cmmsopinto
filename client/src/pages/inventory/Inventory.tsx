import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { InventoryItemCard } from "@/components/inventory/InventoryItemCard";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import {
  Package, Plus, AlertTriangle, Loader2,
  Pencil, Trash2, QrCode, Printer, Search, X, ArrowDownUp, CalendarDays, Truck
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ExportButton } from "@/components/common/ExportButton";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";

export default function Inventory() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [printBarcode, setPrintBarcode] = useState<any>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [deliverItem, setDeliverItem] = useState<any>(null);
  const [deliverQty, setDeliverQty] = useState("");
  const [deliverToId, setDeliverToId] = useState("");
  const [deliverNotes, setDeliverNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "code" | "qr">("name");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "quantity">("recent");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { t, language } = useTranslation();

  const { data: items, isLoading, refetch } = trpc.inventory.list.useQuery();

  const utils = trpc.useUtils();
  const updateMut = trpc.inventory.update.useMutation({
    onSuccess: () => { toast.success(t.common.savedSuccessfully); utils.inventory.list.invalidate(); setEditOpen(false); },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteMut = trpc.inventory.delete.useMutation({
    onSuccess: () => { toast.success(t.common.deletedSuccessfully); utils.inventory.list.invalidate(); setDeleteOpen(false); },
    onError: (err: any) => toast.error(err.message),
  });

  const { data: allUsers = [] } = trpc.users.list.useQuery();
  const deliverMut = trpc.purchaseOrders.deliverInventoryItem.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم التسليم بنجاح — سند ${data.deliveryNumber}`);
      utils.inventory.list.invalidate();
      setDeliverItem(null);
      setDeliverQty("");
      setDeliverToId("");
      setDeliverNotes("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ itemName: "", description: "", quantity: 0, unit: "", minQuantity: 0, location: "" });

  const openEdit = (item: any) => {
    setSelectedItem(item);
    setEditForm({ itemName: item.itemName, description: item.description || "", quantity: item.quantity, unit: item.unit || "", minQuantity: item.minQuantity || 0, location: item.location || "" });
    setEditOpen(true);
  };
  const openDelete = (item: any) => { setSelectedItem(item); setDeleteOpen(true); };

  const isWarehouse = user?.role === "warehouse" || user?.role === "admin" || user?.role === "owner";

  // ── بحث تزايدي: يطابق أي حقل ظاهر في صف الصنف ──
  const filteredItems = (items as any[] || [])
    .filter((item: any) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      if (searchMode === "code" || searchMode === "qr") {
        return (
          String(item.internalCode ?? "").toLowerCase().includes(q) ||
          String(item.manufacturerBarcode ?? "").toLowerCase().includes(q)
        );
      }
      const haystack = [
        item.itemName, item.description, item.unit,
        item.location, item.invoiceDate,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .filter((item: any) => {
      if (!dateFrom && !dateTo) return true;
      if (!item.invoiceDate) return false; // بدون تاريخ فاتورة، لا يُحتسب ضمن الفلتر
      const invDate = new Date(item.invoiceDate).getTime();
      if (dateFrom && invDate < new Date(dateFrom).setHours(0, 0, 0, 0)) return false;
      if (dateTo && invDate > new Date(dateTo).setHours(23, 59, 59, 999)) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      if (sortBy === "name") return (a.itemName || "").localeCompare(b.itemName || "", "ar");
      if (sortBy === "quantity") return (a.quantity || 0) - (b.quantity || 0);
      // recent (الافتراضي): الأحدث أولاً
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> {t.inventory.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t.common.description}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButton endpoint="inventory" filename="inventory" />
          {isWarehouse && (
            <Button className="gap-2" onClick={() => navigate("/inventory/receive")}>
              <Plus className="w-4 h-4" /> {t.common.add}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3 text-center">
            <Package className="w-5 h-5 mx-auto text-blue-600 mb-1" />
            <p className="text-2xl font-bold text-blue-800">{items?.length || 0}</p>
            <p className="text-[10px] text-blue-600">{t.inventory.currentStock}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <AlertTriangle className="w-5 h-5 mx-auto text-red-600 mb-1" />
            <p className="text-2xl font-bold text-red-800">{items?.filter((i: any) => (i.minQuantity || 0) > 0 && i.quantity <= (i.minQuantity || 0)).length || 0}</p>
            <p className="text-[10px] text-red-600">{t.inventory.lowStock}</p>
          </CardContent>
        </Card>
      </div>

      {/* خانة البحث الذكية + الترتيب + فلتر التاريخ */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex-1 space-y-1.5">
          {/* أزرار طريقة البحث */}
          <div className="flex gap-1.5">
            <Button size="sm" variant={searchMode === "name" ? "default" : "outline"} onClick={() => { setSearchMode("name"); setSearchQuery(""); }} className="gap-1 h-7 text-xs">
              <Search className="w-3 h-3" /> بالاسم
            </Button>
            <Button size="sm" variant={searchMode === "code" ? "default" : "outline"} onClick={() => { setSearchMode("code"); setSearchQuery(""); }} className="gap-1 h-7 text-xs">
              <QrCode className="w-3 h-3" /> بالرقم
            </Button>
            <Button size="sm" variant={searchMode === "qr" ? "default" : "outline"} onClick={() => { setSearchMode("qr"); setSearchQuery(""); }} className="gap-1 h-7 text-xs">
              <QrCode className="w-3 h-3" /> QR Code
            </Button>
            {searchQuery && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setSearchQuery(""); setSearchMode("name"); }}>
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* QR Scanner أو خانة نصية */}
          {searchMode === "qr" ? (
            <BarcodeScanner
              onScan={(code) => {
                setSearchQuery(code);
                setSearchMode("code");
              }}
              placeholder="امسح QR Code الصنف..."
            />
          ) : (
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={searchMode === "name" ? "بحث باسم الصنف..." : "بحث برقم الصنف أو الباركود..."}
                className="pr-9 pl-9"
              />
              {searchQuery && (
                <button className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearchQuery("")}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="w-full md:w-[170px] gap-1.5">
            <ArrowDownUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <SelectValue placeholder="ترتيب حسب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">الأحدث أولاً</SelectItem>
            <SelectItem value="name">أبجدياً (الاسم)</SelectItem>
            <SelectItem value="quantity">الأقل كمية أولاً</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full md:w-[150px]"
            aria-label="تاريخ الفاتورة من"
            title="تاريخ الفاتورة من"
          />
          <span className="text-xs text-muted-foreground shrink-0">إلى</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full md:w-[150px]"
            aria-label="تاريخ الفاتورة إلى"
            title="تاريخ الفاتورة إلى"
          />
          {(dateFrom || dateTo) && (
            <button
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              title="مسح فلتر التاريخ"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>)}
        </div>
      ) : !items?.length ? (
        <Card><CardContent className="p-12 text-center">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">{t.common.noData}</h3>
        </CardContent></Card>
      ) : !filteredItems.length ? (
        <Card><CardContent className="p-12 text-center">
          <Search className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">لا توجد نتائج مطابقة</h3>
          <p className="text-sm text-muted-foreground">جرّب كلمة بحث أخرى</p>
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground">
                <th className="text-right font-medium px-3 py-2">الصنف</th>
                <th className="text-right font-medium px-3 py-2">الكود</th>
                <th className="text-right font-medium px-3 py-2">الرصيد</th>
                <th className="text-right font-medium px-3 py-2">الوحدة</th>
                <th className="text-right font-medium px-3 py-2">آخر توريد</th>
                <th className="text-right font-medium px-3 py-2">آخر صرف</th>
                <th className="text-right font-medium px-3 py-2">آخر سعر شراء</th>
                <th className="text-right font-medium px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item: any) => {
                const isLow = (item.minQuantity || 0) > 0 && item.quantity <= (item.minQuantity || 0);
                return (
                  <tr
                    key={item.id}
                    className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{item.itemName}</div>
                      {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                      {isLow && <Badge variant="destructive" className="text-[10px] gap-1 mt-1"><AlertTriangle className="w-3 h-3" /> {t.inventory.lowStock}</Badge>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{item.internalCode || item.manufacturerBarcode || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-bold ${isLow ? "text-destructive" : ""}`}>{item.quantity}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{item.unit || item.issueUnit || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.invoiceDate ? new Date(item.invoiceDate).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.lastIssuedAt ? new Date(item.lastIssuedAt).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.lastPurchasePrice ? `${parseFloat(item.lastPurchasePrice).toLocaleString()} ر.س` : "—"}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {item.manufacturerBarcode && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrintBarcode(item)} title="طباعة باركود">
                            <QrCode className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {isWarehouse && (
                          <>
                            {item.quantity > 0 && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={() => { setDeliverItem(item); setDeliverQty(""); setDeliverToId(""); setDeliverNotes(""); }} title="تسليم للفني">
                                <Truck className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => openDelete(item)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Inventory Item Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.common.edit} - {selectedItem?.itemName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t.inventory.itemName} *</Label><Input value={editForm.itemName} onChange={e => setEditForm(f => ({ ...f, itemName: e.target.value }))} /></div>
            <div className="space-y-2"><Label>{t.common.description}</Label><Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>{t.inventory.currentStock}</Label><Input type="number" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: parseInt(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>{t.inventory.unit}</Label><Input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t.inventory.minStock}</Label><Input type="number" value={editForm.minQuantity} onChange={e => setEditForm(f => ({ ...f, minQuantity: parseInt(e.target.value) || 0 }))} /></div>
            </div>
            <div className="space-y-2"><Label>{t.inventory.location}</Label><Input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => { if (!editForm.itemName) { toast.error(t.inventory.itemName); return; } updateMut.mutate({ id: selectedItem.id, ...editForm }); }} disabled={updateMut.isPending}>
              {updateMut.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── نافذة تسليم للفني ── */}
      <Dialog open={!!deliverItem} onOpenChange={(open) => !open && setDeliverItem(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              تسليم للفني
            </DialogTitle>
          </DialogHeader>
          {deliverItem && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{deliverItem.itemName}</p>
                <p className="text-xs text-muted-foreground">
                  الرصيد المتاح: <strong className="text-foreground">{deliverItem.quantity} {deliverItem.unit}</strong>
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">الكمية المُسلَّمة *</Label>
                <Input
                  type="number"
                  min={0.001}
                  step={0.5}
                  dir="ltr"
                  placeholder="0"
                  value={deliverQty}
                  onChange={e => setDeliverQty(e.target.value)}
                  className="font-mono"
                />
                {deliverQty && parseFloat(deliverQty) > deliverItem.quantity && (
                  <p className="text-xs text-destructive">الكمية أكبر من الرصيد المتاح</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">الفني المُسلَّم إليه</Label>
                <TechnicianCombobox
                  value={deliverToId}
                  onValueChange={setDeliverToId}
                  placeholder="اختر الفني..."
                  options={(allUsers as any[])
                    .filter((u: any) => ["technician", "supervisor", "maintenance_manager"].includes(u.role))
                    .map((u: any) => ({ value: String(u.id), label: `${u.name} (${u.role})` }))}
                />
              </div>

              {/* ملاحظات — تظهر بعد اختيار الفني، كتابتها اختيارية */}
              {deliverToId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">ملاحظات (اختياري)</Label>
                  <Textarea
                    value={deliverNotes}
                    onChange={e => setDeliverNotes(e.target.value)}
                    placeholder="أي ملاحظات إضافية على عملية التسليم..."
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverItem(null)}>إلغاء</Button>
            <Button
              className="gap-1.5"
              disabled={deliverMut.isPending}
              onClick={() => {
                const qty = parseFloat(deliverQty);
                if (!deliverQty || isNaN(qty) || qty <= 0) {
                  toast.error("يرجى إدخال كمية صحيحة أكبر من صفر");
                  return;
                }
                if (qty > (deliverItem.quantity || 0)) {
                  toast.error(`الكمية (${qty}) أكبر من الرصيد المتاح (${deliverItem.quantity})`);
                  return;
                }
                deliverMut.mutate({
                  inventoryId:   deliverItem.id,
                  deliveredToId: deliverToId ? parseInt(deliverToId) : undefined,
                  deliveryQty:   qty,
                  deliveryUnit:  deliverItem.unit || "قطعة",
                  notes:         deliverNotes || undefined,
                });
              }}
            >
              {deliverMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              تأكيد التسليم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* طباعة الباركود — نفس ملصق WarehouseReceiveV2 (58×38مم) */}
      {printBarcode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPrintBarcode(null)}>
          <div className="bg-white rounded-xl p-6 max-w-xs w-full mx-4 print-hidden-wrapper" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-center mb-4">طباعة باركود الصنف</h2>
            <div className="barcode-print-area flex justify-center">
              <div
                className="barcode-card"
                style={{
                  width: "56mm", height: "36mm",
                  display: "flex", flexDirection: "row",
                  alignItems: "center", justifyContent: "flex-start",
                  padding: "2px", gap: "4px",
                  background: "#fff", border: "1px solid #ccc", borderRadius: "4px",
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  <BarcodeQRCanvas value={printBarcode.manufacturerBarcode} size={110} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", paddingRight: "2px", gap: "3px" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: "bold", fontSize: "13px", color: "#000", textAlign: "right", direction: "ltr" }}>
                    {printBarcode.manufacturerBarcode}
                  </span>
                  <span style={{ fontSize: "10px", color: "#222", textAlign: "right", direction: "rtl", lineHeight: "1.3", wordBreak: "break-word", maxWidth: "100%" }}>
                    {printBarcode.itemName}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4 print-hidden">
              <button
                className="flex-1 bg-primary text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
              <button className="flex-1 border py-2 rounded-lg text-sm" onClick={() => setPrintBarcode(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS طباعة الباركود — نفس مقاس الملصق 58×38مم */}
      {printBarcode && (
        <style>{`
          @media print {
            @page { size: 58mm 38mm; margin: 0; }
            html, body { height: 36mm !important; width: 58mm !important; overflow: hidden !important; }
            body * { visibility: hidden; }
            .barcode-print-area, .barcode-print-area * { visibility: visible; }
            .barcode-print-area {
              position: fixed !important; top: 0; left: 0; width: 100% !important; margin: 0 !important;
            }
            .print-hidden, .print-hidden-wrapper > h2 { display: none !important; }
            .print-hidden-wrapper { position: static !important; padding: 0 !important; box-shadow: none !important; }
            .barcode-card {
              width: 56mm !important; height: 36mm !important;
              page-break-inside: avoid;
            }
          }
        `}</style>
      )}

      {/* بطاقة الصنف الرسمية */}
      <InventoryItemCard
        itemId={selectedItemId}
        open={selectedItemId !== null}
        onOpenChange={(open) => !open && setSelectedItemId(null)}
      />

      {/* Delete Inventory Item Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>{t.common.deleteWarning} <strong>{selectedItem?.itemName}</strong>? {t.common.cannotUndo}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate({ id: selectedItem.id })} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── مكوّن QR Code حقيقي (نفس المستخدم في WarehouseReceiveV2) ──
function BarcodeQRCanvas({ value, size = 110 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(console.error);
  }, [value, size]);
  return <canvas ref={canvasRef} width={size} height={size} />;
}
