import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useMemo } from "react";
import { AlertCircle, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";

interface CacheMetrics {
  timestamp: string;
  hitRate: number;
  missRate: number;
  totalRequests: number;
}

interface ResponseTimeMetrics {
  endpoint: string;
  avgTime: number;
  maxTime: number;
  minTime: number;
  requests: number;
}

interface SecurityAlert {
  id: string;
  type: "failed_login" | "rate_limit" | "suspicious_activity";
  message: string;
  timestamp: string;
  severity: "low" | "medium" | "high";
}

export function PerformanceDashboard() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetrics[]>([]);
  const [responseTimeMetrics, setResponseTimeMetrics] = useState<ResponseTimeMetrics[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlert[]>([]);
  const [loading, setLoading] = useState(true);

  // Check if user is admin
  useEffect(() => {
    if (user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  // Fetch metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Simulate fetching metrics from server
        // In production, this would call tRPC procedures
        
        // Mock cache metrics
        const mockCacheMetrics: CacheMetrics[] = [
          { timestamp: "00:00", hitRate: 65, missRate: 35, totalRequests: 1200 },
          { timestamp: "04:00", hitRate: 72, missRate: 28, totalRequests: 1450 },
          { timestamp: "08:00", hitRate: 78, missRate: 22, totalRequests: 2100 },
          { timestamp: "12:00", hitRate: 85, missRate: 15, totalRequests: 2800 },
          { timestamp: "16:00", hitRate: 82, missRate: 18, totalRequests: 2600 },
          { timestamp: "20:00", hitRate: 75, missRate: 25, totalRequests: 1900 },
        ];

        // Mock response time metrics
        const mockResponseTime: ResponseTimeMetrics[] = [
          { endpoint: "users.list", avgTime: 18, maxTime: 45, minTime: 5, requests: 450 },
          { endpoint: "sites.list", avgTime: 15, maxTime: 35, minTime: 4, requests: 380 },
          { endpoint: "tickets.list", avgTime: 45, maxTime: 120, minTime: 12, requests: 890 },
          { endpoint: "purchase_orders.list", avgTime: 52, maxTime: 150, minTime: 15, requests: 650 },
        ];

        // Mock security alerts
        const mockAlerts: SecurityAlert[] = [
          {
            id: "1",
            type: "failed_login",
            message: "Failed login attempt from IP 192.168.1.50",
            timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
            severity: "medium",
          },
          {
            id: "2",
            type: "rate_limit",
            message: "Rate limit exceeded for user ID 45",
            timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
            severity: "low",
          },
          {
            id: "3",
            type: "suspicious_activity",
            message: "Unusual number of API requests detected",
            timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
            severity: "high",
          },
        ];

        setCacheMetrics(mockCacheMetrics);
        setResponseTimeMetrics(mockResponseTime);
        setSecurityAlerts(mockAlerts);
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (!user || user.role !== "admin") {
    return <div className="p-6">ليس لديك صلاحية للوصول إلى هذه الصفحة</div>;
  }

  if (loading) {
    return <div className="p-6">جاري تحميل البيانات...</div>;
  }

  const latestCacheMetrics = useMemo(() => cacheMetrics[cacheMetrics.length - 1], [cacheMetrics]);
  const avgResponseTime = useMemo(
    () => Math.round(
      responseTimeMetrics.reduce((sum, m) => sum + m.avgTime, 0) / (responseTimeMetrics.length || 1)
    ),
    [responseTimeMetrics]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">لوحة مراقبة الأداء</h1>
        <div className="text-sm text-gray-500">آخر تحديث: {new Date().toLocaleTimeString("ar-SA")}</div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              نسبة نجاح الـ Cache
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{latestCacheMetrics?.hitRate}%</div>
            <p className="text-xs text-gray-500 mt-1">
              {latestCacheMetrics?.totalRequests} طلب اليوم
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              متوسط وقت الاستجابة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgResponseTime}ms</div>
            <p className="text-xs text-green-600 mt-1">✓ أداء ممتاز</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              التنبيهات الأمنية
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{securityAlerts.length}</div>
            <p className="text-xs text-orange-600 mt-1">
              {securityAlerts.filter(a => a.severity === "high").length} عالية الأهمية
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cache Hit Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>نسبة نجاح الـ Cache على مدار اليوم</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={cacheMetrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="hitRate" stroke="#10b981" name="نسبة النجاح %" />
              <Line type="monotone" dataKey="missRate" stroke="#ef4444" name="نسبة الفشل %" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Response Time Chart */}
      <Card>
        <CardHeader>
          <CardTitle>متوسط وقت الاستجابة حسب الـ Endpoint</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={responseTimeMetrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="endpoint" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="avgTime" fill="#3b82f6" name="متوسط (ms)" />
              <Bar dataKey="maxTime" fill="#f59e0b" name="الأقصى (ms)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Security Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>التنبيهات الأمنية الأخيرة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {securityAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg border-l-4 ${
                  alert.severity === "high"
                    ? "border-red-500 bg-red-50"
                    : alert.severity === "medium"
                    ? "border-orange-500 bg-orange-50"
                    : "border-yellow-500 bg-yellow-50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{alert.message}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(alert.timestamp).toLocaleString("ar-SA")}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      alert.severity === "high"
                        ? "bg-red-200 text-red-800"
                        : alert.severity === "medium"
                        ? "bg-orange-200 text-orange-800"
                        : "bg-yellow-200 text-yellow-800"
                    }`}
                  >
                    {alert.severity === "high" ? "عالية" : alert.severity === "medium" ? "متوسطة" : "منخفضة"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
