import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Package, ShoppingCart, Warehouse, Truck, Undo2,
  Clock, User, FileText,
} from "lucide-react";

// ─── مصدر الإدخال: شارة توضّح كيف دخل الصنف ───────────────────────────────
function SourceBadge({ sourceType }: { sourceType: string }) {
  if (sourceType === "inventory") {
    return (
      <Badge
        className="gap-1 border-transparent"
        style={{ backgroundColor: "#CD273C1A", color: "#CD273C" }}
      >
        <Warehouse className="w-3 h-3" /> inventory (استلام مستقل)
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 gap-1">
      <ShoppingCart className="w-3 h-3" /> purchase cycle (طلب شراء)
    </Badge>
  );
}

function stageIcon(stage: string) {
  if (stage.includes("مرتجع")) return <Undo2 className="w-4 h-4" />;
  if (stage.includes("تسليم") || stage.includes("خصم")) return <Truck className="w-4 h-4" />;
  if (stage.includes("استلام") || stage.includes("إضافة") || stage.includes("زيادة")) return <Warehouse className="w-4 h-4" />;
  if (stage.includes("شراء") || stage.includes("طلب")) return <ShoppingCart className="w-4 h-4" />;
  return <Clock className="w-4 h-4" />;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ar-SA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ItemTracker() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const { data: nameOptions, isLoading: isSearchingNames, isFetching: isFetchingNames } =
    trpc.purchaseOrders.searchItemNames.useQuery(
      { query: searchTerm },
      { enabled: searchTerm.trim().length >= 2 && !selectedName }
    );

  const { data, isLoading, isFetching } = trpc.purchaseOrders.trackItem.useQuery(
    { itemName: selectedName || "", exactMatch: true },
    { enabled: !!selectedName }
  );

  const handleSearch = () => {
    if (query.trim().length < 2) return;
    setSelectedName(null);
    setSearchTerm(query.trim());
  };

  const handleBackToNames = () => {
    setSelectedName(null);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Package className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold">تتبع صنف</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        اكتب اسم الصنف (أو جزء منه) لعرض قصته الزمنية الكاملة: من طلب الشراء أو
        الاستلام المستقل، مروراً بالمخزون، وحتى التسليم أو الإرجاع.
      </p>

      <div className="flex gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="مثال: سلك تربيط"
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={query.trim().length < 2} className="gap-1">
          <Search className="w-4 h-4" /> بحث
        </Button>
      </div>

      {/* خطوة 1: قائمة أسماء الأصناف المطابقة — تظهر قبل اختيار صنف محدد */}
      {!selectedName && (isSearchingNames || isFetchingNames) && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {!selectedName && !isSearchingNames && !isFetchingNames && searchTerm && nameOptions && nameOptions.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد أصناف بهذا الاسم "{searchTerm}"
          </CardContent>
        </Card>
      )}

      {!selectedName && nameOptions && nameOptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {nameOptions.length > 1
              ? `وُجد ${nameOptions.length} صنف مطابق — اختر الصنف المقصود بالضبط:`
              : "اختر الصنف لعرض قصته الزمنية:"}
          </p>
          {nameOptions.map((name: string) => (
            <Card
              key={name}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setSelectedName(name)}
            >
              <CardContent className="py-3 flex items-center justify-between">
                <span className="text-sm font-medium">{name}</span>
                <Package className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* خطوة 2: التايم لاين الكامل بعد اختيار صنف محدد */}
      {selectedName && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">النتائج لصنف: {selectedName}</p>
          <Button variant="ghost" size="sm" onClick={handleBackToNames}>
            ← رجوع لقائمة الأصناف
          </Button>
        </div>
      )}

      {selectedName && (isLoading || isFetching) && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {selectedName && !isLoading && !isFetching && data && data.events.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد أي أحداث مسجّلة لهذا الصنف
          </CardContent>
        </Card>
      )}

      {selectedName && data && data.events.length > 0 && (
        <>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>بنود طلبات شراء مطابقة: {data.poItemsFound}</span>
            <span>·</span>
            <span>سجلات مخزون مطابقة: {data.inventoryRecordsFound}</span>
          </div>

          <div className="relative space-y-3 ps-4 border-s-2 border-dashed border-muted">
            {data.events.map((ev: any, idx: number) => (
              <Card key={idx} className="relative">
                <span className="absolute -start-[27px] top-4 w-3 h-3 rounded-full bg-primary" />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {stageIcon(ev.stage)} {ev.stage}
                    </CardTitle>
                    <SourceBadge sourceType={ev.sourceType} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-medium">{ev.title}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDate(ev.date)}
                    </span>
                    {ev.poNumber && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {ev.poNumber}
                      </span>
                    )}
                    {ev.receiptNumber && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {ev.receiptNumber}
                      </span>
                    )}
                  </div>
                  {ev.standaloneReason && (
                    <p className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 rounded p-2 mt-1">
                      سبب الاستلام المستقل: {ev.standaloneReason}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
