import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Users, User } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  manager: "مدير", supervisor: "مشرف", engineer: "مهندس",
  technician: "فني", subcontractor: "مقاول فرعي", viewer: "مشاهد",
};

const ROLE_COLORS: Record<string, string> = {
  manager: "bg-[#1A2B4A] text-white",
  supervisor: "bg-teal-100 text-teal-700",
  engineer: "bg-blue-100 text-blue-700",
  technician: "bg-orange-100 text-orange-700",
  subcontractor: "bg-purple-100 text-purple-700",
  viewer: "bg-slate-100 text-slate-600",
};

export default function ProjectMembers({ projectId }: { projectId: number }) {
  const { data: members, isLoading } = trpc.construction.members.list.useQuery({ projectId });
  const { data: workload } = trpc.construction.members.workload.useQuery({ projectId });

  const workloadMap = Object.fromEntries((workload ?? []).map(w => [w.userId, w]));

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#1A2B4A] flex items-center gap-2">
          <Users className="w-4 h-4" /> أعضاء الفريق ({members?.length ?? 0})
        </h3>
      </div>

      {!members || members.length === 0 ? (
        <Card><CardContent className="py-10 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">لا يوجد أعضاء في الفريق</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {members.map(member => {
            const wl = workloadMap[member.userId];
            const activeTasks = Number(wl?.activeCount ?? 0);
            const totalTasks = Number(wl?.totalCount ?? 0);
            const workloadPct = totalTasks > 0 ? Math.round((activeTasks / Math.max(totalTasks, 5)) * 100) : 0;

            return (
              <Card key={member.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#1A2B4A] rounded-full flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-[#1A2B4A]">مستخدم #{member.userId}</p>
                        <p className="text-xs text-slate-400">
                          انضم {new Date(member.joinedAt).toLocaleDateString("ar")}
                        </p>
                      </div>
                    </div>
                    <Badge className={`text-xs rounded-full ${ROLE_COLORS[member.role]}`}>
                      {ROLE_LABELS[member.role]}
                    </Badge>
                  </div>

                  {/* Workload */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>الأحمال</span>
                      <span>{activeTasks} مهمة نشطة</span>
                    </div>
                    <Progress
                      value={workloadPct}
                      className={`h-2 ${workloadPct > 80 ? "[&>div]:bg-red-500" : workloadPct > 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`}
                    />
                    {workloadPct > 80 && (
                      <p className="text-xs text-red-500 mt-1">⚠ الأحمال مرتفعة</p>
                    )}
                  </div>

                  {/* Permissions */}
                  <div className="flex gap-1 mt-3 flex-wrap">
                    {member.canEdit && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">تعديل</span>}
                    {member.canApprove && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded">اعتماد</span>}
                    {member.canDelete && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">حذف</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
