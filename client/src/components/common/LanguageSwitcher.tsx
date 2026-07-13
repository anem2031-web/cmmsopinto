import { useLanguage, LANGUAGE_CONFIGS, type SupportedLanguage } from "@/contexts/LanguageContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

const LANGUAGES: SupportedLanguage[] = ["ar", "en", "ur"];

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 h-8 px-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors text-sm text-sidebar-foreground/80">
          <Globe className="h-4 w-4" />
          {!compact && <span className="text-xs font-medium">{LANGUAGE_CONFIGS[language].nativeName}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {LANGUAGES.map(lang => (
          <DropdownMenuItem
            key={lang}
            onClick={() => setLanguage(lang)}
            className={`cursor-pointer gap-2 ${language === lang ? "bg-primary/10 text-primary font-medium" : ""}`}
          >
            <span className="text-sm">{LANGUAGE_CONFIGS[lang].nativeName}</span>
            {language === lang && (
              <span className="mr-auto text-primary text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
