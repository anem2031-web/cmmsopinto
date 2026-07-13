import { Check, X } from "lucide-react";

interface PasswordRequirement {
  label: string;
  met: boolean;
}

interface PasswordStrengthIndicatorProps {
  password: string;
  className?: string;
}

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { label: "8 أحرف على الأقل", met: password.length >= 8 },
    { label: "حرف كبير (A-Z)", met: /[A-Z]/.test(password) },
    { label: "رقم واحد على الأقل (0-9)", met: /\d/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return getPasswordRequirements(password).every(r => r.met);
}

export function PasswordStrengthIndicator({ password, className = "" }: PasswordStrengthIndicatorProps) {
  if (!password) return null;

  const requirements = getPasswordRequirements(password);
  const metCount = requirements.filter(r => r.met).length;

  const strengthColor =
    metCount === 0 ? "bg-muted"
    : metCount === 1 ? "bg-destructive"
    : metCount === 2 ? "bg-amber-400"
    : "bg-green-500";

  const strengthLabel =
    metCount === 3 ? "قوية" : metCount === 2 ? "متوسطة" : "ضعيفة";

  return (
    <div className={`space-y-2 ${className}`}>
      {/* شريط القوة */}
      <div className="flex gap-1 items-center">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              i <= metCount ? strengthColor : "bg-muted"
            }`}
          />
        ))}
        <span className={`text-xs font-medium mr-1 ${
          metCount === 3 ? "text-green-600" : metCount === 2 ? "text-amber-500" : "text-destructive"
        }`}>
          {strengthLabel}
        </span>
      </div>

      {/* قائمة المتطلبات */}
      <ul className="space-y-1">
        {requirements.map((req, i) => (
          <li key={i} className={`flex items-center gap-1.5 text-xs transition-colors ${
            req.met ? "text-green-600" : "text-muted-foreground"
          }`}>
            {req.met
              ? <Check className="w-3.5 h-3.5 shrink-0 text-green-500" />
              : <X className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
            }
            {req.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
