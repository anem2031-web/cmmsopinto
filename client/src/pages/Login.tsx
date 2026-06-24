import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wrench, Loader2, Eye, EyeOff, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";


export default function Login() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [gracePeriodWarning, setGracePeriodWarning] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      // Check 2FA enforcement status from server response
      if (data.twoFactorEnforcementStatus?.isEnforced) {
        setTwoFactorRequired(true);
        toast.error("المصادقة الثنائية إلزامية. يرجى تفعيلها الآن.");
        return;
      }
      
      if (data.twoFactorEnforcementStatus?.withinGracePeriod) {
        setGracePeriodWarning(
          `⏰ فترة السماح: بقي لك ${data.twoFactorEnforcementStatus.daysUntilEnforcement} أيام لتفعيل المصادقة الثنائية`
        );
      }
      
      // Redirect after 2 seconds to show warning
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    },
    onError: (err) => {
      toast.error(err.message || "خطأ في تسجيل الدخول");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("يرجى ملء جميع الحقول");
      return;
    }
    loginMut.mutate({ username: username.trim(), password });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10" dir="rtl">
      <Card className="w-full max-w-md mx-4 shadow-xl border">
        <CardContent className="p-8 space-y-6">
          {/* زر تغيير اللغة */}
          <div className="flex justify-start [&_button]:text-foreground [&_button]:hover:bg-accent">
            <LanguageSwitcher />
          </div>
          {/* Grace Period Warning */}
          {gracePeriodWarning && (
            <Alert className="border-orange-200 bg-orange-50">
              <Clock className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-800 text-right">
                {gracePeriodWarning}
              </AlertDescription>
            </Alert>
          )}

          {/* 2FA Required Alert */}
          {twoFactorRequired && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 text-right">
                🔒 المصادقة الثنائية إلزامية الآن. يرجى الانتقال إلى إعدادات الحساب لتفعيلها.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col items-center gap-5 text-center">
            {/* الأيقونة */}
            <div className="w-20 h-20 rounded-3xl bg-primary flex items-center justify-center shadow-lg shadow-primary/25">
              <Wrench className="w-10 h-10 text-primary-foreground" />
            </div>
            <div className="space-y-2">
              {/* CMMS كعنوان رئيسي بارز */}
              <div className="flex items-center justify-center">
                <span className="text-2xl font-black tracking-[0.15em] text-primary">CMMS</span>
              </div>
              {/* اسم النظام */}
              <h1 className="text-sm font-bold tracking-tight whitespace-nowrap">
                {t.appName}
              </h1>

            </div>
          </div>

          {!twoFactorRequired && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{(t as any).users?.username ?? "اسم المستخدم"}</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={(t as any).users?.username ?? "اسم المستخدم"}
                autoComplete="username"
                autoFocus
                className="text-right"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{(t as any).users?.password ?? "كلمة المرور"}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={(t as any).users?.password ?? "كلمة المرور"}
                  autoComplete="current-password"
                  className="text-right pl-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loginMut.isPending}
            >
              {loginMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : null}
              {t.login}
            </Button>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
