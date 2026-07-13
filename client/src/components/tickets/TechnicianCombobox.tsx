import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// عنصر واحد بقائمة الفنيين: label نص بسيط يُستخدم للبحث/الفلترة،
// وrender (اختياري) عرض مخصص (نقطة لون/الدور/التخصص...) لو الشكل مختلف عن النص البسيط
export interface TechnicianOption {
  value: string;
  label: string;
  render?: React.ReactNode;
}

interface TechnicianComboboxProps {
  options: TechnicianOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}

// قائمة منسدلة فيها خانة بحث للفنيين (Popover + Command) — بديل لـ <Select> العادي
// عند ما تكون قائمة الفنيين طويلة، تقدر تكتب اسم الفني وتترشّح القائمة فوراً
export function TechnicianCombobox({
  options,
  value,
  onValueChange,
  placeholder = "اختر فنياً...",
  searchPlaceholder = "بحث عن فني...",
  emptyText = "لا يوجد فني مطابق",
  className,
}: TechnicianComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate flex items-center gap-2">
            {selected ? (selected.render ?? selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(opt => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4", value === opt.value ? "opacity-100" : "opacity-0")} />
                  {opt.render ?? opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
