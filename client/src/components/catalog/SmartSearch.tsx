import React, { useState, useCallback, useMemo } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SmartSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Fetch items based on search query
  const { data: searchResults, isLoading } = trpc.catalog.items.list.useQuery(
    {
      search: query,
      limit: 10,
    },
    {
      enabled: query.length > 0,
    }
  );

  // Fetch categories for filtering
  const { data: categories } = trpc.catalog.nodes.list.useQuery({
    isActive: true,
    level: 1,
  });

  const results = useMemo(() => {
    if (!searchResults) return [];
    return searchResults;
  }, [searchResults]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setIsOpen(true);
    setSelectedIndex(-1);
  }, []);

  const handleClear = useCallback(() => {
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(-1);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelectResult(results[selectedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const handleSelectResult = (item: any) => {
    // Handle result selection - can be extended later
    console.log("Selected item:", item);
    setIsOpen(false);
  };

  return (
    <div className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
        <Input
          type="text"
          placeholder={t.catalog.search.placeholder}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setIsOpen(true)}
          className="pl-10 pr-10 py-3 text-lg"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-slate-100 rounded"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {isOpen && query && (
        <Card className="absolute top-full left-0 right-0 mt-2 shadow-lg z-50">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="ml-2 text-slate-600">
                  {t.catalog.search.searching}
                </span>
              </div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                {t.catalog.search.noResults}
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {results.map((item: any, index: number) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectResult(item)}
                    className={cn(
                      "px-4 py-3 cursor-pointer border-b last:border-b-0 transition-colors",
                      selectedIndex === index
                        ? "bg-blue-50"
                        : "hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Item Image */}
                      {item.primaryImageUrl && (
                        <img
                          src={item.primaryImageUrl}
                          alt={item.nameAr}
                          className="w-12 h-12 rounded object-cover"
                        />
                      )}

                      {/* Item Details */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {item.nameAr}
                        </p>
                        <p className="text-sm text-slate-600">
                          {item.nameEn}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {t.catalog.search.code}: {item.itemCode}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Filters */}
      {!isOpen && categories && categories.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-600 mb-2">
            {t.catalog.search.categories}
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.slice(0, 5).map((category) => (
              <Button
                key={category.id}
                variant="outline"
                size="sm"
                className="rounded-full"
              >
                {category.nameAr}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
