import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { TicketReportMedia as ReportMedia } from "@shared/maintenance-team-tickets/assignment";

export function TicketReportMedia({
  media = [],
  language,
}: {
  media?: ReportMedia[];
  language: string;
}) {
  const [selected, setSelected] = useState<ReportMedia | null>(null);
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  if (!media.length) return null;
  return (
    <div className="space-y-2" onClick={event => event.stopPropagation()}>
      <p className="text-xs font-medium text-muted-foreground">
        {l(
          "صور وفيديو البلاغ",
          "Report photos and videos",
          "رپورٹ کی تصاویر اور ویڈیوز"
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {media.map((item, index) => (
          <button
            key={`${item.url}:${index}`}
            type="button"
            aria-label={`${l(item.type === "video" ? "عرض فيديو البلاغ" : "عرض صورة البلاغ", item.type === "video" ? "View report video" : "View report photo", item.type === "video" ? "رپورٹ کی ویڈیو دیکھیں" : "رپورٹ کی تصویر دیکھیں")} ${index + 1}`}
            className="relative h-20 w-24 overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSelected(item)}
          >
            {item.type === "image" ? (
              <img
                src={item.url}
                alt={
                  item.name ||
                  l("صورة البلاغ", "Report photo", "رپورٹ کی تصویر")
                }
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <video
                  src={item.url}
                  preload="none"
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
                <PlayCircle
                  aria-hidden
                  className="absolute inset-0 m-auto h-8 w-8 rounded-full bg-background/80 text-primary"
                />
              </>
            )}
          </button>
        ))}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-4xl max-h-[90vh] overflow-auto"
          dir={language === "en" ? "ltr" : "rtl"}
        >
          <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div className="min-w-0">
              <DialogTitle>
                {l("وسائط البلاغ", "Report media", "رپورٹ کا میڈیا")}
              </DialogTitle>
              <DialogDescription className="truncate">
                {selected?.name ||
                  l(
                    "صورة أو فيديو مرفق بالبلاغ",
                    "Photo or video attached to the report",
                    "رپورٹ سے منسلک تصویر یا ویڈیو"
                  )}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelected(null)}
            >
              {l("إغلاق", "Close", "بند کریں")}
            </Button>
          </DialogHeader>
          {selected?.type === "image" && (
            <img
              src={selected.url}
              alt={
                selected.name ||
                l("صورة البلاغ", "Report photo", "رپورٹ کی تصویر")
              }
              className="max-h-[70vh] w-full object-contain"
            />
          )}
          {selected?.type === "video" && (
            <video
              key={selected.url}
              src={selected.url}
              controls
              playsInline
              preload="metadata"
              className="max-h-[70vh] w-full bg-black"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
