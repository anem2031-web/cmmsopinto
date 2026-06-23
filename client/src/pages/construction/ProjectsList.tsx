import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Building2, Plus, Search, FolderKanban, Clock, Filter } from "lucide-react";

const statusColors: Record<string, string> = {
  planning:  "bg-slate-100 text-slate-700",
  active:    "bg-teal-100 text-teal-700",
  on_hold:   "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  planning:  "تخطيط",
  active:    "نشط",
  on_hold:   "موقوف",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const priorityBorder: Record<string, string> = {
  low:      "border-l-slate-400",
  medium:   "border-l-blue-400",
  high:     "border-l-orange-400",
  critical: "border-l-red-500",
};

const priorityLabels: Record<string, string> = {
  low: "منخفض", medium: "متوسط", high: "عال", critical: "حرج",
};

export default function ProjectsList() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = trpc.construction.projects.list.useQuery({
    search: search || undefined,
    status: status === "all" ? undefined : status,
    isArchived: false,
    page,
    pageSize: 12,
  });

  const projects = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2B4A] flex items-center gap-2">
            <FolderKanban className="w-7 h-7 text-[#E07B39]" />
            المشاريع الإنشائية
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data?.total ?? 0} مشروع إجمالاً
          </p>
        </div>
        <Button
          onClick={() => navigate("/construction/projects/new")}
          className="bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          مشروع جديد
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="بحث باسم المشروع أو الرقم..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pr-9 text-right"
          />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحالات</SelectItem>
            <SelectItem value="planning">تخطيط</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="on_hold">موقوف</SelectItem>
            <SelectItem value="completed">مكتمل</SelectItem>
            <SelectItem value="cancelled">ملغي</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-48 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">لا توجد مشاريع</p>
            <p className="text-sm text-slate-400 mt-1">
              {search ? "لا توجد نتائج للبحث" : "ابدأ بإنشاء أول مشروع"}
            </p>
            {!search && (
              <Button onClick={() => navigate("/construction/projects/new")}
                className="mt-4 bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-2">
                <Plus className="w-4 h-4" /> إنشاء مشروع
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <Card
              key={project.id}
              className={`border-l-4 ${priorityBorder[project.priority]} cursor-pointer hover:shadow-md transition-all`}
              onClick={() => navigate(`/construction/projects/${project.id}`)}
            >
              <CardContent className="p-5 space-y-3">
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-400">{project.projectNumber}</p>
                    <h3 className="font-semibold text-[#1A2B4A] text-sm leading-snug mt-0.5 line-clamp-2">
                      {project.name}
                    </h3>
                  </div>
                  <Badge className={`text-xs px-2 rounded-full flex-shrink-0 ${statusColors[project.status]}`}>
                    {statusLabels[project.status]}
                  </Badge>
                </div>

                {/* Progress */}
                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>الإنجاز</span>
                    <span className="font-semibold text-[#1A2B4A]">
                      {Number(project.progressPercent ?? 0).toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={Number(project.progressPercent ?? 0)} className="h-1.5" />
                </div>

                {/* Meta */}
                <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-100">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{project.endDatePlanned ?? "غير محدد"}</span>
                  </div>
                  <span className="text-slate-300">|</span>
                  <span className={`font-medium ${
                    project.priority === "critical" ? "text-red-500" :
                    project.priority === "high" ? "text-orange-500" :
                    project.priority === "medium" ? "text-blue-500" : "text-slate-400"
                  }`}>
                    {priorityLabels[project.priority]}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}>السابق</Button>
          <span className="text-sm text-slate-500">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}>التالي</Button>
        </div>
      )}
    </div>
  );
}
