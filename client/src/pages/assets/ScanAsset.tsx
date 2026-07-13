import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ScanLine,
  MapPin,
  Package,
  Tag,
  ArrowRight,
  AlertTriangle,
  Keyboard,
  Building2,
} from "lucide-react";

type ScanState = "idle" | "scanning" | "success" | "error";

interface ScannedAsset {
  id: number;
  assetNumber: string;
  name: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  siteId?: number | null;
  sectionId?: number | null;
  locationDetail?: string | null;
  photoUrl?: string | null;
  rfidTag?: string | null;
}
interface ScannedSection {
  id: number;
  name: string;
}

interface ScannedSite {
  id: number;
  name: string;
  address?: string | null;
}

export default function ScanAsset() {
  const { t: tr } = useLanguage();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [scannedAsset, setScannedAsset] = useState<ScannedAsset | null>(null);
  const [scannedSite, setScannedSite] = useState<ScannedSite | null>(null);
  const [scannedSection, setScannedSection] = useState<ScannedSection | null>(null);
  const [manualTag, setManualTag] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const [scannedRawTag, setScannedRawTag] = useState<string>("");
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const nfcReaderRef = useRef<any>(null);
  const scanMutation = trpc.nfc.scanTag.useMutation();
  const linkMutation = trpc.assets.linkRfidTag.useMutation();
  const assetsQuery = trpc.assets.list.useQuery({});

  // Check NFC support on mount
  useEffect(() => {
    if ("NDEFReader" in window) {
      setNfcSupported(true);
    } else {
      setNfcSupported(false);
    }
  }, []);

  // Start NFC scanning
  const startNFCScan = async () => {
    if (!("NDEFReader" in window)) {
      setShowManualInput(true);
      return;
    }
    setScanState("scanning");
    setErrorMessage("");
    setScannedAsset(null);
    try {
      const ndef = new (window as any).NDEFReader();
      nfcReaderRef.current = ndef;
      await ndef.scan();
      ndef.onreading = async (event: any) => {
        // Helper: get Uint8Array from DataView or ArrayBuffer
        const toUint8 = (data: any): Uint8Array => {
          if (data instanceof Uint8Array) return data;
          if (data instanceof ArrayBuffer) return new Uint8Array(data);
          if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset ?? 0, data.byteLength ?? data.buffer.byteLength);
          return new Uint8Array(0);
        };

        let tag: string | null = null;
        const debugLines: string[] = [];

        if (event.message?.records?.length > 0) {
          debugLines.push(`records: ${event.message.records.length}`);
          for (const record of event.message.records) {
            try {
              debugLines.push(`type: ${record.recordType}`);
              const rawData = toUint8(record.data);
              debugLines.push(`bytes: ${rawData.length}`);

              if (record.recordType === "text") {
                // NDEF Text Record:
                // Byte 0: status (bit7=UTF16, bits5-0=lang length)
                // Bytes 1..langLen: language code
                // Remaining: actual text
                if (rawData.length > 0) {
                  const statusByte = rawData[0];
                  const langLen = statusByte & 0x3f;
                  const isUtf16 = (statusByte & 0x80) !== 0;
                  debugLines.push(`status: 0x${statusByte.toString(16)} langLen: ${langLen} utf16: ${isUtf16}`);
                  
                  // Validate this is a real NDEF text record:
                  // langLen must be 1-8, there must be text after it,
                  // AND the language bytes must be ASCII letters only (e.g. "en", "ar")
                  const hasRoomForText = langLen >= 1 && langLen <= 8 && (1 + langLen < rawData.length);
                  const langBytes = hasRoomForText ? rawData.slice(1, 1 + langLen) : new Uint8Array(0);
                  const langIsLetters = Array.from(langBytes).every((b: number) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122));
                  const isValidNDEF = hasRoomForText && langIsLetters;

                  if (isValidNDEF) {
                    // Real NDEF Text Record: skip status byte + language code
                    const textBytes = rawData.slice(1 + langLen);
                    const encoding = isUtf16 ? "utf-16" : "utf-8";
                    const text = new TextDecoder(encoding).decode(textBytes).trim();
                    debugLines.push(`text decoded (NDEF): "${text}"`);
                    if (text) { tag = text; break; }
                  } else {
                    // Plain text tag: decode entire rawData as-is
                    debugLines.push(`plain text decode (langLen=${langLen} not valid NDEF)`);
                    const text = new TextDecoder("utf-8").decode(rawData).trim();
                    if (text) { tag = text; break; }
                  }
                }
              } else if (record.recordType === "url" || record.recordType === "absolute-url") {
                const url = new TextDecoder().decode(rawData).trim();
                debugLines.push(`url: ${url}`);
                const match = url.match(/[?&]rfid=([^&]+)/);
                if (match) { tag = decodeURIComponent(match[1]); break; }
                const pathMatch = url.match(/\/([^\/\?#]+)(?:[\?#].*)?$/);
                if (pathMatch) { tag = pathMatch[1]; break; }
                tag = url; break;
              } else if (record.recordType === "mime" || record.recordType === "unknown" || record.data) {
                const text = new TextDecoder().decode(rawData).trim();
                debugLines.push(`raw text: "${text}"`);
                if (text) { tag = text; break; }
              }
            } catch (e: any) {
              debugLines.push(`err: ${e?.message}`);
            }
          }
        } else {
          debugLines.push("no records");
        }

        console.log("[NFC Debug]", debugLines.join(" | "));

        // Only use text from records, NOT the serial number
        if (!tag) {
          const debugInfo = debugLines.join(" | ");
          console.warn("[NFC] No text found in records. Debug:", debugInfo);
          setScannedRawTag(`${event.serialNumber || "unknown"} | debug: ${debugInfo}`);
          setScanState("error");
          setErrorMessage(t.nfc.assetNotFound + ". " + t.nfc.registerHintSub);
          return;
        }

        setScannedRawTag(tag);
        await processTag(tag.toString().trim());
      };
      ndef.onerror = () => {
        setScanState("error");
        setErrorMessage(t.nfc.scanError);
      };
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setErrorMessage(t.nfc.permissionDenied);
      } else {
        setErrorMessage(t.nfc.notSupported);
        setShowManualInput(true);
      }
      setScanState("error");
    }
  };

  // Process a scanned or manually entered tag
  const processTag = async (rfidTag: string) => {
    setScanState("scanning");
    setErrorMessage("");
    setScannedRawTag(rfidTag.trim());
    try {
      const result = await scanMutation.mutateAsync({ rfidTag: rfidTag.trim() });
      setScannedAsset(result.asset);
      setScannedSite(result.site);
      setScannedSection(result.section ?? null);
      setScanState("success");
    } catch (err: any) {
      setScanState("error");
      if (err?.data?.code === "NOT_FOUND") {
        setErrorMessage(t.nfc.assetNotFound + ". " + t.nfc.registerHintSub);
      } else {
        setErrorMessage(err?.message || t.nfc.unknownError);
      }
    }
  };

  // Handle manual tag submission
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTag.trim()) return;
    await processTag(manualTag.trim());
  };

  // Navigate to create ticket with pre-filled data
  const handleCreateTicket = () => {
    if (!scannedAsset) return;
    const params = new URLSearchParams({
      assetId: scannedAsset.id.toString(),
      assetName: scannedAsset.name,
      assetNumber: scannedAsset.assetNumber,
      ...(scannedAsset.siteId && { siteId: scannedAsset.siteId.toString() }),
      ...(scannedSite && { siteName: scannedSite.name }),
      ...(scannedAsset.sectionId && { sectionId: scannedAsset.sectionId.toString() }),
      ...(scannedAsset.locationDetail && { locationDetail: scannedAsset.locationDetail }),
      fromNFC: "true",
    });
    navigate(`/tickets/new?${params.toString()}`);
  };

  // Link RFID tag to asset
  const handleLinkTag = async (assetId: number) => {
    try {
      await linkMutation.mutateAsync({ assetId, rfidTag: scannedRawTag });
      setShowLinkDialog(false);
      setScanState("success");
      const asset = assetsQuery.data?.find((a: any) => a.id === assetId);
      if (asset) {
        setScannedAsset({
          id: asset.id,
          assetNumber: asset.assetNumber,
          name: asset.name,
          category: asset.category,
          rfidTag: scannedRawTag,
        });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "خطأ في ربط البطاقة");
    }
  };

  // Reset to idle
  const handleReset = () => {
    setScanState("idle");
    setErrorMessage("");
    setScannedAsset(null);
    setScannedSite(null);
    setManualTag("");
    setShowLinkDialog(false);
    setSelectedCategory("");
    if (nfcReaderRef.current) {
      try { nfcReaderRef.current.abort?.(); } catch {}
      nfcReaderRef.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start pt-8 px-4 pb-24">
      {/* Header */}
      <div className="w-full max-w-md mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <ScanLine className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t.nfc.title}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t.nfc.subtitle}</p>
        {/* NFC Support Badge */}
        <div className="mt-3 flex justify-center">
          {nfcSupported === true && (
            <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50">
              <Wifi className="w-3 h-3" /> {t.nfc.supported}
            </Badge>
          )}
          {nfcSupported === false && (
            <Badge variant="outline" className="gap-1 text-orange-600 border-orange-300 bg-orange-50">
              <WifiOff className="w-3 h-3" /> {t.nfc.notSupportedBadge}
            </Badge>
          )}
        </div>
      </div>

      {/* Main Scan Area */}
      <div className="w-full max-w-md">

        {/* IDLE STATE */}
        {scanState === "idle" && (
          <div className="flex flex-col items-center gap-6">
            {/* Animated Scan Circle */}
            <div className="relative flex items-center justify-center">
              <div className="w-48 h-48 rounded-full border-4 border-primary/20 flex items-center justify-center bg-primary/5">
                <div className="w-36 h-36 rounded-full border-2 border-primary/30 flex items-center justify-center bg-primary/10">
                  <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center">
                    <ScanLine className="w-12 h-12 text-primary" />
                  </div>
                </div>
              </div>
              {/* Pulse ring */}
              <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping" style={{ animationDuration: "2s" }} />
            </div>

            <p className="text-lg font-semibold text-foreground text-center">{t.nfc.readyToScan}</p>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              {nfcSupported ? t.nfc.tapInstruction : t.nfc.manualInstruction}
            </p>

            <div className="flex flex-col gap-3 w-full">
              {nfcSupported && (
                <Button size="lg" className="w-full h-14 text-base gap-2" onClick={startNFCScan}>
                  <Wifi className="w-5 h-5" />
                  {t.nfc.startScan}
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                className="w-full h-12 gap-2"
                onClick={() => setShowManualInput(!showManualInput)}
              >
                <Keyboard className="w-4 h-4" />
                {t.nfc.manualEntry}
              </Button>
            </div>

            {/* Manual Input */}
            {showManualInput && (
              <Card className="w-full border-dashed">
                <CardContent className="pt-4">
                  <form onSubmit={handleManualSubmit} className="flex flex-col gap-3">
                    <label className="text-sm font-medium text-foreground">{t.nfc.enterTagId}</label>
                    <Input
                      value={manualTag}
                      onChange={(e) => setManualTag(e.target.value)}
                      placeholder="TAG-001 أو 04:AB:CD:EF"
                      className="text-center font-mono text-base h-12"
                      autoFocus
                      dir="ltr"
                    />
                    <Button type="submit" disabled={!manualTag.trim()} className="w-full h-11">
                      {t.nfc.search}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* SCANNING STATE */}
        {scanState === "scanning" && (
          <div className="flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <div className="w-48 h-48 rounded-full border-4 border-primary/30 flex items-center justify-center bg-primary/5">
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
              </div>
              <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
            </div>
            <p className="text-lg font-semibold text-primary animate-pulse">{t.nfc.scanning}</p>
            <p className="text-sm text-muted-foreground text-center">{t.nfc.holdDevice}</p>
            <Button variant="outline" onClick={handleReset} className="w-full">
              {t.common.cancel}
            </Button>
          </div>
        )}

        {/* SUCCESS STATE */}
        {scanState === "success" && scannedAsset && (
          <div className="flex flex-col gap-4">
            {/* Success Icon */}
            <div className="flex flex-col items-center gap-2 mb-2">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
              <p className="text-lg font-bold text-green-700">{t.nfc.assetFound}</p>
            </div>

            {/* Asset Card */}
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="pt-4 space-y-3">
                {/* Asset Photo */}
                {scannedAsset.photoUrl && (
                  <div className="flex justify-center mb-2">
                    <img
                      src={scannedAsset.photoUrl.startsWith("/api/media")
                        ? `${window.location.origin}${scannedAsset.photoUrl}`
                        : scannedAsset.photoUrl}
                      alt={scannedAsset.name}
                      className="w-28 h-28 rounded-xl object-cover border-2 border-green-200 shadow-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                )}

                {/* Asset Name */}
                <div className="flex items-start gap-2">
                  <Package className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t.assets.assetName}</p>
                    <p className="font-semibold text-foreground">{scannedAsset.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{scannedAsset.assetNumber}</p>
                  </div>
                </div>

                {/* Location */}
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t.tickets.site}</p>
                    <p className="font-medium text-foreground">
                      {scannedSite?.name || t.common.none}
                    </p>
                    {scannedAsset.locationDetail && (
                      <p className="text-xs text-muted-foreground">{scannedAsset.locationDetail}</p>
                    )}
                  </div>
                </div>
                {/* Section */}
                {scannedSection && (
                  <div className="flex items-start gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t.tickets.section}</p>
                      <p className="font-medium text-foreground">{scannedSection.name}</p>
                    </div>
                  </div>
                )}

                {/* RFID Tag */}
                <div className="flex items-start gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t.nfc.tagId}</p>
                    <p className="font-mono text-sm text-foreground">{scannedAsset.rfidTag}</p>
                  </div>
                </div>

                {/* Category / Brand */}
                {(scannedAsset.category || scannedAsset.brand) && (
                  <div className="flex gap-2 flex-wrap pt-1">
                    {scannedAsset.category && (
                      <Badge variant="secondary" className="text-xs">{scannedAsset.category}</Badge>
                    )}
                    {scannedAsset.brand && (
                      <Badge variant="outline" className="text-xs">{scannedAsset.brand}</Badge>
                    )}
                    {scannedAsset.model && (
                      <Badge variant="outline" className="text-xs">{scannedAsset.model}</Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full h-14 text-base gap-2"
                onClick={handleCreateTicket}
              >
                {t.nfc.createTicket}
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button variant="outline" className="w-full h-11" onClick={handleReset}>
                {t.nfc.scanAnother}
              </Button>
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {scanState === "error" && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center">
              {errorMessage.includes("غير موجود") ? (
                <AlertTriangle className="w-14 h-14 text-red-500" />
              ) : (
                <XCircle className="w-14 h-14 text-red-500" />
              )}
            </div>

            <div className="text-center space-y-2">
              <p className="text-lg font-bold text-red-700">
                {errorMessage.includes("غير موجود") ? t.nfc.assetNotFound : t.nfc.scanFailed}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs text-center">{errorMessage}</p>
              {scannedRawTag && (
                <div className="mt-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-500">الرمز المقروء من البطاقة:</p>
                  <p className="font-mono text-sm font-bold text-gray-800 mt-0.5">{scannedRawTag}</p>
                </div>
              )}
            </div>

            {/* If asset not found, show register hint */}
            {errorMessage.includes("غير موجود") && (
              <Card className="w-full border-orange-200 bg-orange-50/50">
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <p className="text-sm text-orange-700 font-medium">{t.nfc.registerHint}</p>
                    <p className="text-xs text-orange-600 mt-1">{t.nfc.registerHintSub}</p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                      onClick={() => setShowLinkDialog(true)}
                    >
                      ربط بأصل
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-orange-300 text-orange-700 hover:bg-orange-100"
                      onClick={() => navigate("/assets")}
                    >
                      {t.nfc.goToAssets}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-col gap-3 w-full">
              <Button className="w-full h-12" onClick={handleReset}>
                {t.nfc.tryAgain}
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 gap-2"
                onClick={() => { handleReset(); setShowManualInput(true); }}
              >
                <Keyboard className="w-4 h-4" />
                {t.nfc.manualEntry}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Link Dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-foreground mb-2">ربط بطاقة NFC بأصل</h3>
                <p className="text-sm text-muted-foreground">الرمز: <span className="font-mono font-bold">{scannedRawTag}</span></p>
              </div>

              {/* Category Filter */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">القسم (اختياري)</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="">جميع الأقسام</option>
                  <option value="mechanical">ميكانيكي</option>
                  <option value="electrical">كهربائي</option>
                  <option value="hydraulic">هيدروليكي</option>
                  <option value="pneumatic">هوائي</option>
                </select>
              </div>

              {/* Assets List */}
              <div className="border border-border rounded-md max-h-64 overflow-y-auto">
                {assetsQuery.isLoading && (
                  <div className="p-4 text-center text-muted-foreground">جاري التحميل...</div>
                )}
                {assetsQuery.data?.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground">لا توجد أصول</div>
                )}
                {assetsQuery.data?.map((asset: any) => (
                  <button
                    key={asset.id}
                    onClick={() => handleLinkTag(asset.id)}
                    disabled={linkMutation.isPending}
                    className="w-full text-left px-4 py-2 hover:bg-accent border-b border-border last:border-b-0 disabled:opacity-50"
                  >
                    <p className="font-medium text-foreground">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">{asset.assetNumber}</p>
                    {asset.category && <p className="text-xs text-muted-foreground">القسم: {asset.category}</p>}
                  </button>
                ))}
              </div>

              {/* Close Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowLinkDialog(false)}
              >
                إلغاء
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
