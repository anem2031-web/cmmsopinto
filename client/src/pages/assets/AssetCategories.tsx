import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag, Plus, Pencil, Trash2, Check, X } from "lucide-react";

export default function AssetCategories() {
  const { t } = useLanguage();

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  const utils = trpc.useUtils();
  const { data: categories = [], isLoading } = trpc.assetCategories.list.useQuery();

  const createCategoryMut = trpc.assetCategories.create.useMutation({
    onSuccess: () => {
      utils.assetCategories.list.invalidate();
      setNewCategoryName("");
      toast.success("تم إضافة الفئة بنجاح");
    },
    onError: () => toast.error("حدث خطأ، حاول مرة أخرى"),
  });

  const updateCategoryMut = trpc.assetCategories.update.useMutation({
    onSuccess: () => {
      utils.assetCategories.list.invalidate();
      setEditCategoryId(null);
      setEditCategoryName("");
      toast.success("تم تعديل الفئة بنجاح");
    },
    onError: () => toast.error("حدث خطأ، حاول مرة أخرى"),
  });

  const deleteCategoryMut = trpc.assetCategories.delete.useMutation({
    onSuccess: () => {
      utils.assetCategories.list.invalidate();
      toast.success("تم حذف الفئة بنجاح");
    },
    onError: () => toast.error("حدث خطأ، حاول مرة أخرى"),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Tag className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">إدارة الفئات</h1>
          <p className="text-muted-foreground text-sm">إضافة وتعديل وحذف فئات الأصول</p>
        </div>
      </div>

      {/* Add New Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">إضافة فئة جديدة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="اسم الفئة الجديدة"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCategoryName.trim()) {
                  createCategoryMut.mutate({ name: newCategoryName.trim() });
                }
              }}
            />
            <Button
              onClick={() => {
                if (newCategoryName.trim()) {
                  createCategoryMut.mutate({ name: newCategoryName.trim() });
                }
              }}
              disabled={createCategoryMut.isPending || !newCategoryName.trim()}
            >
              <Plus className="h-4 w-4 ml-1" />
              إضافة
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Categories List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            الفئات الحالية
            {categories.length > 0 && (
              <span className="mr-2 text-sm font-normal text-muted-foreground">
                ({categories.length} فئة)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد فئات بعد. أضف أول فئة من الأعلى.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map((c: { id: number; name: string }) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 border rounded-lg px-4 py-3 bg-background hover:bg-muted/30 transition-colors"
                >
                  {editCategoryId === c.id ? (
                    <>
                      <Input
                        className="flex-1"
                        value={editCategoryName}
                        onChange={(e) => setEditCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editCategoryName.trim()) {
                            updateCategoryMut.mutate({ id: c.id, name: editCategoryName.trim() });
                          }
                          if (e.key === "Escape") {
                            setEditCategoryId(null);
                            setEditCategoryName("");
                          }
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (editCategoryName.trim()) {
                            updateCategoryMut.mutate({ id: c.id, name: editCategoryName.trim() });
                          }
                        }}
                        disabled={updateCategoryMut.isPending || !editCategoryName.trim()}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditCategoryId(null);
                          setEditCategoryName("");
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm font-medium">{c.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditCategoryId(c.id);
                          setEditCategoryName(c.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 ml-1" />
                        تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => deleteCategoryMut.mutate({ id: c.id })}
                        disabled={deleteCategoryMut.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 ml-1" />
                        حذف
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
