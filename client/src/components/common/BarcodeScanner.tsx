import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Keyboard, X, ScanLine } from "lucide-react";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  placeholder?: string;
}

export default function BarcodeScanner({ onScan, placeholder = "امسح أو أدخل الباركود" }: BarcodeScannerProps) {
  const [mode, setMode] = useState<"input" | "camera">("input");
  const [value, setValue] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const startCamera = async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setScanning(true);

      // Use BarcodeDetector if available
      if ("BarcodeDetector" in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8"] });
        const interval = setInterval(async () => {
          if (!videoRef.current || !streamRef.current) { clearInterval(interval); return; }
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              clearInterval(interval);
              stopCamera();
              setMode("input");
              onScan(barcodes[0].rawValue);
            }
          } catch {}
        }, 500);
      } else {
        setCameraError("الكاميرا تعمل لكن مسح الباركود غير مدعوم في هذا المتصفح. أدخل الرقم يدوياً.");
      }
    } catch {
      setCameraError("تعذّر الوصول للكاميرا. أدخل الباركود يدوياً.");
      setMode("input");
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleManualSubmit = () => {
    if (value.trim()) {
      onScan(value.trim());
      setValue("");
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "input" ? "default" : "outline"}
          onClick={() => { setMode("input"); stopCamera(); }}
          className="gap-1"
        >
          <Keyboard className="w-4 h-4" />
          يدوي
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "camera" ? "default" : "outline"}
          onClick={() => { setMode("camera"); startCamera(); }}
          className="gap-1"
        >
          <Camera className="w-4 h-4" />
          كاميرا
        </Button>
      </div>

      {/* Camera View */}
      {mode === "camera" && (
        <div className="relative rounded-lg overflow-hidden bg-black border border-border">
          <video ref={videoRef} className="w-full h-48 object-cover" muted playsInline />
          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-32 border-2 border-green-400 rounded-lg flex items-center justify-center">
                <ScanLine className="w-8 h-8 text-green-400 animate-pulse" />
              </div>
            </div>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
            onClick={() => { stopCamera(); setMode("input"); }}
          >
            <X className="w-4 h-4" />
          </Button>
          {cameraError && (
            <p className="absolute bottom-2 left-2 right-2 text-xs text-red-400 bg-black/70 p-1 rounded text-center">
              {cameraError}
            </p>
          )}
        </div>
      )}

      {/* Manual Input */}
      {mode === "input" && (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
            placeholder={placeholder}
            dir="ltr"
            className="font-mono"
          />
          <Button type="button" onClick={handleManualSubmit} disabled={!value.trim()}>
            بحث
          </Button>
        </div>
      )}
    </div>
  );
}
