# ============================================================
# scan.ps1 — يشغّل السكانر عبر WIA (Windows Image Acquisition)
# ويحفظ الصورة الممسوحة كملف JPEG في المسار المُمرَّر.
#
# يعمل مع أي سكانر مسجّل كجهاز WIA بويندوز (يشمل Epson L6270
# وأغلب طابعات/سكانرات Epson و Canon و HP الحديثة).
#
# الاستخدام: powershell -ExecutionPolicy Bypass -File scan.ps1 -OutputPath "C:\temp\scan.jpg"
# المخرجات: سطر JSON واحد على stdout: {"success":true,"path":"..."} أو {"success":false,"error":"..."}
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Write-Result($success, $data) {
    $result = @{ success = $success } + $data
    $result | ConvertTo-Json -Compress
}

try {
    $manager = New-Object -ComObject WIA.DeviceManager

    if ($manager.DeviceInfos.Count -eq 0) {
        Write-Result $false @{ error = "لم يتم العثور على أي سكانر متصل. تأكد إن السكانر شغّال ومتوصّل، وإنه ظاهر في تطبيق 'Windows Fax and Scan' الجاهز بويندوز." }
        exit 1
    }

    # اختيار أول جهاز سكانر (Scanner) — لو فيه أكتر من جهاز WIA (طابعة + كاميرا مثلاً)
    # بنفضّل أي جهاز من نوع Scanner (Type = 1) بدل أول جهاز عشوائي
    $deviceInfo = $null
    for ($i = 1; $i -le $manager.DeviceInfos.Count; $i++) {
        $candidate = $manager.DeviceInfos.Item($i)
        if ($candidate.Type -eq 1) { $deviceInfo = $candidate; break }
    }
    if ($null -eq $deviceInfo) { $deviceInfo = $manager.DeviceInfos.Item(1) }

    $device = $deviceInfo.Connect()
    $item = $device.Items.Item(1)

    # ── ضبط إعدادات المسح (لون، دقة 300 نقطة/بوصة) — بمحاولة آمنة لأن بعض
    # السكانرات لا تدعم كل الخصائص، فنتجاهل أي فشل بضبط خاصية بعينها ──
    function Set-WiaProperty($properties, $propId, $value) {
        try {
            foreach ($p in $properties) {
                if ($p.PropertyID -eq $propId) { $p.Value = $value; return }
            }
        } catch { }
    }

    Set-WiaProperty $item.Properties 6146 1     # Current Intent: 1 = Color
    Set-WiaProperty $item.Properties 6147 300   # Horizontal Resolution (DPI)
    Set-WiaProperty $item.Properties 6148 300   # Vertical Resolution (DPI)

    # صيغة JPEG القياسية بـ WIA
    $wiaFormatJPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
    $image = $item.Transfer($wiaFormatJPEG)

    # حذف أي ملف قديم بنفس المسار قبل الحفظ (WIA بيرفض الحفظ فوق ملف موجود)
    if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
    $image.SaveFile($OutputPath)

    Write-Result $true @{ path = $OutputPath }
}
catch {
    Write-Result $false @{ error = $_.Exception.Message }
    exit 1
}
