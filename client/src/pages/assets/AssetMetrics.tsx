import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { AlertCircle, TrendingUp, Activity, ArrowLeft } from "lucide-react";

interface MetricsData {
  id: number;
  assetId: number;
  totalTickets: number;
  closedTickets: number;
  totalDowntime: number;
  mttr: string | number;
  mtbf: string | number;
  availability: string | number;
  lastFailureDate: Date | null;
  lastRepairDate: Date | null;
}

export default function AssetMetrics() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const [selectedAsset, setSelectedAsset] = useState<number | null>(null);

  if (!user) {
    setLocation("/");
    return null;
  }

  const { data: allMetrics = [], isLoading: metricsLoading } = trpc.assets.getAllMetrics.useQuery();
  const { data: selectedMetrics } = trpc.assets.getMetrics.useQuery(
    { assetId: selectedAsset || 0 },
    { enabled: !!selectedAsset }
  );
  const { data: assets = [] } = trpc.assets.list.useQuery();

  // Prepare chart data
  const chartData = allMetrics.map((m: MetricsData) => ({
    assetId: m.assetId,
    mttr: parseFloat(String(m.mttr)),
    mtbf: parseFloat(String(m.mtbf)),
    availability: parseFloat(String(m.availability)),
    tickets: m.totalTickets,
  }));

  const availabilityData = allMetrics.map((m: MetricsData) => ({
    name: `${t.assetMetrics.asset} ${m.assetId}`,
    available: parseFloat(String(m.availability)),
    downtime: 100 - parseFloat(String(m.availability)),
  }));

  const COLORS = ["#10b981", "#ef4444"];

  const getAvailabilityStatus = (availability: number) => {
    if (availability >= 95) return { label: t.assetMetrics.excellent, color: "text-green-600" };
    if (availability >= 85) return { label: t.assetMetrics.good, color: "text-blue-600" };
    if (availability >= 75) return { label: t.assetMetrics.fair, color: "text-yellow-600" };
    return { label: t.assetMetrics.poor, color: "text-red-600" };
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/assets")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">{t.assetMetrics.title}</h1>
              <p className="text-muted-foreground mt-2">{t.assetMetrics.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {selectedMetrics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  {t.assetMetrics.mttr}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{parseFloat(String(selectedMetrics.mttr)).toFixed(2)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t.assetMetrics.mttrFull}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  {t.assetMetrics.mtbf}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{parseFloat(String(selectedMetrics.mtbf)).toFixed(2)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t.assetMetrics.mtbfFull}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  {t.assetMetrics.availability}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${getAvailabilityStatus(parseFloat(String(selectedMetrics.availability))).color}`}>
                  {parseFloat(String(selectedMetrics.availability)).toFixed(2)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {getAvailabilityStatus(parseFloat(String(selectedMetrics.availability))).label}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {t.assetMetrics.totalTickets}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{selectedMetrics.totalTickets}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedMetrics.closedTickets} {t.assetMetrics.closedTickets}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* MTTR vs MTBF Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.mttrVsMtbf}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="assetId" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="mttr" fill="#3b82f6" name={`MTTR (${t.assetMetrics.hours})`} />
                  <Bar dataKey="mtbf" fill="#10b981" name={`MTBF (${t.assetMetrics.hours})`} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Availability Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.availabilityTrend}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="assetId" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="availability" stroke="#10b981" name={`${t.assetMetrics.availability} %`} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Availability Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.availabilityBreakdown}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={availabilityData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, available }) => `${name}: ${available.toFixed(1)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="available"
                  >
                    {availabilityData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Tickets Trend */}
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.ticketsTrend}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="assetId" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="tickets" fill="#f59e0b" name={t.assetMetrics.totalTickets} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Asset Selection */}
        {!selectedMetrics && (
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.selectAsset}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {assets.map((asset: any) => (
                  <Button
                    key={asset.id}
                    variant={selectedAsset === asset.id ? "default" : "outline"}
                    onClick={() => setSelectedAsset(asset.id)}
                    className="w-full"
                  >
                    {asset.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Metrics Table */}
        {allMetrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t.assetMetrics.allMetrics}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4">{t.assetMetrics.asset}</th>
                      <th className="text-right py-2 px-4">MTTR (h)</th>
                      <th className="text-right py-2 px-4">MTBF (h)</th>
                      <th className="text-right py-2 px-4">{t.assetMetrics.availability}</th>
                      <th className="text-right py-2 px-4">{t.assetMetrics.totalTickets}</th>
                      <th className="text-right py-2 px-4">{t.assetMetrics.totalDowntime}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allMetrics.map((m: MetricsData) => (
                      <tr key={m.id} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedAsset(m.assetId)}>
                        <td className="py-2 px-4">{t.assetMetrics.asset} {m.assetId}</td>
                        <td className="text-right py-2 px-4">{parseFloat(String(m.mttr)).toFixed(2)}</td>
                        <td className="text-right py-2 px-4">{parseFloat(String(m.mtbf)).toFixed(2)}</td>
                        <td className={`text-right py-2 px-4 font-semibold ${getAvailabilityStatus(parseFloat(String(m.availability))).color}`}>
                          {parseFloat(String(m.availability)).toFixed(2)}%
                        </td>
                        <td className="text-right py-2 px-4">{m.totalTickets}</td>
                        <td className="text-right py-2 px-4">{m.totalDowntime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {metricsLoading && (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">{t.common.loading}</p>
            </CardContent>
          </Card>
        )}

        {!metricsLoading && allMetrics.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">{t.assetMetrics.noMetrics}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
