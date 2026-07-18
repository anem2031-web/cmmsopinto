import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Circle, Square, Video, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ───── إعدادات الضغط أثناء التسجيل (بنفس فلسفة واتساب) ─────
// الهدف: ملف صغير من اللحظة الأولى بدل تسجيل عالي الجودة ثم ضغطه لاحقاً.
const VIDEO_WIDTH_IDEAL = 1280; // 720p
const VIDEO_HEIGHT_IDEAL = 720;
const VIDEO_BITRATE = 1_500_000; // ~1.5 Mbps
const AUDIO_BITRATE = 128_000; // 128 kbps
const MAX_DURATION_SEC = 13; // حد أقصى لمدة التسجيل (قابل للتعديل)

// أفضل mimeType متاح في المتصفح الحالي (يفضّل H.264/MP4، ثم WebM كبديل)
function pickMimeType(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
    { mimeType: 'video/webm;codecs="vp9,opus"', ext: "webm" },
    { mimeType: 'video/webm;codecs="vp8,opus"', ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: "", ext: "webm" };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onRecorded: (file: File) => void;
};

export default function VideoRecorderModal({ open, onClose, onRecorded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async (mode: "environment" | "user") => {
    setError(null);
    setReady(false);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: VIDEO_WIDTH_IDEAL },
          height: { ideal: VIDEO_HEIGHT_IDEAL },
          frameRate: { ideal: 30 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (err: any) {
      setError(
        err?.name === "NotAllowedError"
          ? "تم رفض الوصول للكاميرا. الرجاء السماح بالوصول من إعدادات المتصفح."
          : "تعذر فتح الكاميرا على هذا الجهاز."
      );
    }
  }, [stopStream]);

  useEffect(() => {
    if (open) {
      startStream(facingMode);
    } else {
      stopStream();
      setIsRecording(false);
      setSeconds(0);
      chunksRef.current = [];
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const switchCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startStream(next);
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    const { mimeType, ext } = pickMimeType();
    chunksRef.current = [];

    const options: MediaRecorderOptions = {
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    };
    if (mimeType) options.mimeType = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(streamRef.current, options);
    } catch {
      // fallback بدون تحديد mimeType لو المتصفح رفض الإعدادات
      recorder = new MediaRecorder(streamRef.current);
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blobType = recorder.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      const finalExt = blobType.includes("mp4") ? "mp4" : ext;
      const file = new File([blob], `ticket-video-${Date.now()}.${finalExt}`, {
        type: blobType,
      });
      onRecorded(file);
      handleClose();
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setSeconds(0);

    timerRef.current = setInterval(() => {
      setSeconds(prev => {
        const next = prev + 1;
        if (next >= MAX_DURATION_SEC) {
          stopRecording();
        }
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleClose = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    stopStream();
    setIsRecording(false);
    setSeconds(0);
    onClose();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const r = (s % 60).toString().padStart(2, "0");
    return `${m}:${r}`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            تصوير فيديو للبلاغ
          </DialogTitle>
        </DialogHeader>

        <div className="relative bg-black aspect-[9/16] max-h-[70vh] flex items-center justify-center">
          {error ? (
            <div className="text-center text-white p-6 text-sm">{error}</div>
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          )}

          {isRecording && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {formatTime(seconds)} / {formatTime(MAX_DURATION_SEC)}
            </div>
          )}

          {!isRecording && ready && (
            <button
              onClick={switchCamera}
              className="absolute top-3 left-3 bg-black/60 text-white p-2 rounded-full"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4 flex items-center justify-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="w-5 h-5" />
          </Button>

          {!isRecording ? (
            <button
              disabled={!ready}
              onClick={startRecording}
              className={cn(
                "w-16 h-16 rounded-full border-4 border-primary flex items-center justify-center transition-transform active:scale-95",
                !ready && "opacity-40"
              )}
            >
              <Circle className="w-11 h-11 fill-red-500 text-red-500" />
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="w-16 h-16 rounded-full border-4 border-red-500 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Square className="w-8 h-8 fill-red-500 text-red-500" />
            </button>
          )}

          <div className="w-9" /> {/* لموازنة التخطيط */}
        </div>

        <p className="text-center text-xs text-muted-foreground pb-3 px-4">
          يتم ضغط الفيديو أثناء التسجيل (720p تقريباً، ~1.5 ميجابت/ثانية) لتقليل الحجم قبل الرفع
        </p>
      </DialogContent>
    </Dialog>
  );
}
