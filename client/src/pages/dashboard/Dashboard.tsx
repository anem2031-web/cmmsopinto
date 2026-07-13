import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  // Single optimized API call — replaces N+1 assets.list + listByAsset loop
  const { data, isLoading } = trpc.inspectionResults.dashboardStats.useQuery();

  const severityColorClass: Record<string, string> = {
    low: "text-green-600",
    medium: "text-yellow-600",
    high: "text-orange-600",
    critical: "text-red-600",
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold">📊 التقارير</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const totalInspections     = data?.totalInspections ?? 0;
  const mostFrequentRootCause = data?.mostFrequentRootCause ?? "-";
  const highestSeverity       = data?.highestSeverity ?? "low";
  const mostInspectedAsset    = data?.mostInspectedAsset ?? null;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold">📊 التقارير</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Card 1 — Total Inspections */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">عدد الفحوصات</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalInspections}</p>
          </CardContent>
        </Card>

        {/* Card 2 — Most Frequent Root Cause */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">أكثر سبب تكراراً</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-bold break-words">{mostFrequentRootCause}</p>
          </CardContent>
        </Card>

        {/* Card 3 — Highest Severity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">أعلى خطورة</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${severityColorClass[highestSeverity] || ""}`}>
              {highestSeverity}
            </p>
          </CardContent>
        </Card>

        {/* Card 4 — Most Inspected Asset */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">أكثر أصل تم فحصه</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-bold break-words">
              {mostInspectedAsset ? `Asset #${mostInspectedAsset.assetId}` : "-"}
            </p>
            {mostInspectedAsset && (
              <p className="text-xs text-muted-foreground mt-1">
                {mostInspectedAsset.count} فحص
              </p>
            )}
          </CardContent>
        </Card>

      </div>

      {totalInspections === 0 && (
        <p className="text-center text-muted-foreground text-sm pt-4">لا توجد بيانات فحص متاحة</p>
      )}

      {/* التحليل البصري */}
      {totalInspections > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-bold">📈 التحليل البصري</h3>

          {/* Root Cause Bar */}
          {mostFrequentRootCause !== "-" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">أكثر سبب تكراراً</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{mostFrequentRootCause}</span>
                    <span className="text-muted-foreground">{totalInspections} فحص</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded h-3">
                    <div className="bg-blue-500 h-3 rounded" style={{ width: "100%" }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Severity Indicator */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">مؤشر الخطورة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(["low", "medium", "high", "critical"] as const).map((level) => {
                const severityBgClass: Record<string, string> = {
                  low: "bg-green-500",
                  medium: "bg-yellow-500",
                  high: "bg-orange-500",
                  critical: "bg-red-500",
                };
                const severityLabelAr: Record<string, string> = {
                  low: "منخفض",
                  medium: "متوسط",
                  high: "مرتفع",
                  critical: "حرج",
                };
                const severityOrder = ["low", "medium", "high", "critical"];
                const currentIdx = severityOrder.indexOf(highestSeverity);
                const levelIdx   = severityOrder.indexOf(level);
                const widthPct   = levelIdx <= currentIdx ? Math.round(((levelIdx + 1) / (currentIdx + 1)) * 100) : 0;
                const isActive   = levelIdx <= currentIdx;
                return (
                  <div key={level} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className={`font-medium ${isActive ? severityColorClass[level] : "text-muted-foreground"}`}>
                        {severityLabelAr[level]}
                      </span>
                      {level === highestSeverity && <span className="text-xs font-bold">← الحالي</span>}
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded h-2">
                      <div
                        className={`h-2 rounded transition-all ${isActive ? severityBgClass[level] : ""}`}
                        style={{ width: isActive ? `${widthPct}%` : "0%" }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
