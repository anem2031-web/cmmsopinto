import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function AssetDetail() {
  const [, params] = useRoute("/asset/:id");
  const [, navigate] = useLocation();
  const assetId = params?.id ? Number(params.id) : null;

  const { data: assets = [], isLoading: assetsLoading } = trpc.assets.list.useQuery({});
  const { data: categories = [] } = trpc.assetCategories.list.useQuery();
  const { data: inspectionResults = [], isLoading: inspLoading } = trpc.inspectionResults.listByAsset.useQuery(
    { assetId: assetId! },
    { enabled: !!assetId }
  );
  const { data: tickets = [] } = trpc.tickets.list.useQuery({});

  const asset = assets.find((a: any) => a.id === assetId);
  const categoryName = asset?.categoryId
    ? categories.find((c: any) => c.id === asset.categoryId)?.name
    : null;
  const assetTickets = tickets.filter((t: any) => t.assetId === assetId);

  const severityColor: Record<string, string> = {
    low: "text-green-600",
    medium: "text-yellow-600",
    high: "text-orange-600",
    critical: "text-red-600",
  };

  if (assetsLoading) {
    return <div className="p-6 text-muted-foreground">جاري التحميل...</div>;
  }

  if (!asset) {
    return <div className="p-6 text-muted-foreground">الأصل غير موجود.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back button */}
      <Button variant="outline" size="sm" onClick={() => navigate("/assets")}>
        <ArrowRight className="h-4 w-4 ml-2" />
        العودة إلى الأصول
      </Button>

      {/* Section 1 — Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>معلومات الأصل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="font-semibold">الاسم:</span>
            <span>{asset.name}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold">رقم الأصل:</span>
            <span>{asset.assetNumber}</span>
          </div>
          {categoryName && (
            <div className="flex gap-2">
              <span className="font-semibold">الفئة:</span>
              <span className="text-blue-600 font-medium">{categoryName}</span>
            </div>
          )}
          {asset.category && (
            <div className="flex gap-2">
              <span className="font-semibold">التصنيف:</span>
              <span>{asset.category}</span>
            </div>
          )}
          {asset.brand && (
            <div className="flex gap-2">
              <span className="font-semibold">الماركة:</span>
              <span>{asset.brand}</span>
            </div>
          )}
          {asset.model && (
            <div className="flex gap-2">
              <span className="font-semibold">الموديل:</span>
              <span>{asset.model}</span>
            </div>
          )}
          {asset.serialNumber && (
            <div className="flex gap-2">
              <span className="font-semibold">الرقم التسلسلي:</span>
              <span>{asset.serialNumber}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="font-semibold">الحالة:</span>
            <span>{asset.status}</span>
          </div>
          {asset.locationDetail && (
            <div className="flex gap-2">
              <span className="font-semibold">الموقع:</span>
              <span>{asset.locationDetail}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="font-semibold">تاريخ الإنشاء:</span>
            <span>{new Date(asset.createdAt).toLocaleDateString("ar-SA")}</span>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Inspection History */}
      <Card>
        <CardHeader>
          <CardTitle>سجل الفحوصات</CardTitle>
        </CardHeader>
        <CardContent>
          {inspLoading ? (
            <p className="text-sm text-muted-foreground">جاري التحميل...</p>
          ) : inspectionResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد فحوصات مسجلة لهذا الأصل.</p>
          ) : (
            <div className="space-y-3">
              {inspectionResults.map((r: any) => (
                <div key={r.id} className="border rounded p-3 space-y-1 text-sm">
                  <div className="flex gap-2">
                    <span className="font-semibold">التاريخ:</span>
                    <span>{new Date(r.createdAt).toLocaleDateString("ar-SA")}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-semibold">الخطورة:</span>
                    <span className={severityColor[r.severity] ?? ""}>{r.severity}</span>
                  </div>
                  {r.rootCause && (
                    <div className="flex gap-2">
                      <span className="font-semibold">السبب الجذري:</span>
                      <span>{r.rootCause}</span>
                    </div>
                  )}
                  {r.findings && (
                    <div className="flex gap-2">
                      <span className="font-semibold">النتائج:</span>
                      <span>{r.findings}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3 — Tickets */}
      <Card>
        <CardHeader>
          <CardTitle>البلاغات المرتبطة</CardTitle>
        </CardHeader>
        <CardContent>
          {assetTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد بلاغات مرتبطة بهذا الأصل.</p>
          ) : (
            <div className="space-y-2">
              {assetTickets.map((t: any) => (
                <div key={t.id} className="border rounded p-3 text-sm flex justify-between items-center">
                  <div>
                    <span className="font-semibold">#{t.id}</span>
                    {" — "}
                    <span>{t.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{t.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
