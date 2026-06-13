import React, { useState } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Settings, Loader2, Check } from "lucide-react";

export default function CatalogSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState({
    requireSupplier: false,
    autoGenerateCode: true,
    enableBulkImport: true,
    maxImageSize: 5,
    requirePrimaryImage: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fetch settings
  const { data: catalogSettings, isLoading } = trpc.catalog.settings.list.useQuery();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Simulate saving (in real implementation, would call mutation)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data Entry Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {t.catalog.settings.dataEntry}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Require Supplier */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded">
            <div>
              <p className="font-medium text-slate-900">
                {t.catalog.settings.requireSupplier}
              </p>
              <p className="text-sm text-slate-600">
                {"يجب تحديد مورد واحد على الأقل عند إضافة صنف"}
              </p>
            </div>
            <Switch
              checked={settings.requireSupplier}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, requireSupplier: checked })
              }
            />
          </div>

          {/* Auto Generate Code */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded">
            <div>
              <p className="font-medium text-slate-900">
                {t.catalog.settings.autoCode}
              </p>
              <p className="text-sm text-slate-600">
                {"توليد كود الصنف تلقائياً بناءً على القسم"}
              </p>
            </div>
            <Switch
              checked={settings.autoGenerateCode}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, autoGenerateCode: checked })
              }
            />
          </div>

          {/* Enable Bulk Import */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded">
            <div>
              <p className="font-medium text-slate-900">
                {t.catalog.settings.bulkImport}
              </p>
              <p className="text-sm text-slate-600">
                {"السماح برفع ملفات Excel لإضافة أصناف متعددة"}
              </p>
            </div>
            <Switch
              checked={settings.enableBulkImport}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, enableBulkImport: checked })
              }
            />
          </div>

          {/* Require Primary Image */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded">
            <div>
              <p className="font-medium text-slate-900">
                {t.catalog.settings.requireImage}
              </p>
              <p className="text-sm text-slate-600">
                {"يجب إضافة صورة رئيسية لكل صنف"}
              </p>
            </div>
            <Switch
              checked={settings.requirePrimaryImage}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, requirePrimaryImage: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* System Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t.catalog.settings.system}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Max Image Size */}
          <div>
            <label className="text-sm font-medium text-slate-900">
              {t.catalog.settings.maxImageSize}
            </label>
            <Input
              type="number"
              value={settings.maxImageSize}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxImageSize: parseInt(e.target.value) || 5,
                })
              }
              min="1"
              max="50"
              className="mt-2"
            />
            <p className="text-xs text-slate-500 mt-1">
              {"الحد الأقصى لحجم الصورة الواحدة عند الرفع"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Dangerous Zone */}
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-700">
            {t.catalog.settings.dangerZone}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-red-600">
            {"هذه الإجراءات قد تؤدي إلى فقدان البيانات. يرجى التأكد قبل المتابعة."}
          </p>
          <Button variant="destructive" className="w-full">
            {t.catalog.settings.resetCatalog}
          </Button>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <div>
          {saved && (
            <div className="flex items-center gap-2 text-green-600">
              <Check className="w-5 h-5" />
              <span>{t.common.save}</span>
            </div>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          size="lg"
          className="gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.common.saving}
            </>
          ) : (
            t.common.save
          )}
        </Button>
      </div>
    </div>
  );
}
