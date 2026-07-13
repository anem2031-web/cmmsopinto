import { useState, useEffect } from "react";
import { Clock, AlertTriangle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SLATimerProps {
  createdAt: number | Date;
  statusChangedAt?: number | Date | null;
  statusLabel?: string;
  compact?: boolean;
}

function getElapsed(from: number | Date): { hours: number; minutes: number; totalHours: number } {
  const fromMs = from instanceof Date ? from.getTime() : from;
  const diffMs = Date.now() - fromMs;
  const totalHours = diffMs / (1000 * 60 * 60);
  const hours = Math.floor(totalHours);
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return { hours, minutes, totalHours };
}

function formatElapsed(hours: number, minutes: number): string {
  if (hours === 0) return `${minutes} دقيقة`;
  if (hours < 24) return `${hours} ساعة${minutes > 0 ? ` و${minutes} دقيقة` : ""}`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days} يوم${remHours > 0 ? ` و${remHours} ساعة` : ""}`;
}

export function SLATimer({ createdAt, statusChangedAt, statusLabel, compact = false }: SLATimerProps) {
  const [elapsed, setElapsed] = useState(() => getElapsed(statusChangedAt || createdAt));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(getElapsed(statusChangedAt || createdAt));
    }, 60_000); // update every minute
    return () => clearInterval(interval);
  }, [createdAt, statusChangedAt]);

  const { hours, minutes, totalHours } = elapsed;

  // SLA color logic
  const isRed = totalHours >= 48;
  const isOrange = totalHours >= 24 && !isRed;
  const isGreen = totalHours < 24;

  const colorClass = isRed
    ? "text-red-600 bg-red-50 border-red-200"
    : isOrange
    ? "text-orange-600 bg-orange-50 border-orange-200"
    : "text-emerald-600 bg-emerald-50 border-emerald-200";

  const Icon = isRed ? AlertCircle : isOrange ? AlertTriangle : Clock;

  const label = statusLabel
    ? `${statusLabel} منذ ${formatElapsed(hours, minutes)}`
    : `منذ ${formatElapsed(hours, minutes)}`;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`gap-1 text-xs font-medium border ${colorClass} cursor-default`}
            >
              <Icon className="h-3 w-3" />
              {formatElapsed(hours, minutes)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
            {isRed && <p className="text-red-500 font-semibold">⚠️ تجاوز 48 ساعة - يحتاج تدخل فوري</p>}
            {isOrange && <p className="text-orange-500 font-semibold">⚠️ تجاوز 24 ساعة - يحتاج مراجعة</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {isRed && <span className="font-bold">⚠️</span>}
    </div>
  );
}

export function SLABadge({ createdAt, statusChangedAt }: { createdAt: number | Date; statusChangedAt?: number | Date | null }) {
  const elapsed = getElapsed(statusChangedAt || createdAt);
  const { totalHours } = elapsed;

  if (totalHours >= 48) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600 font-semibold">
        <AlertCircle className="h-3 w-3" />
        متأخر جداً
      </span>
    );
  }
  if (totalHours >= 24) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-semibold">
        <AlertTriangle className="h-3 w-3" />
        يحتاج مراجعة
      </span>
    );
  }
  return null;
}
