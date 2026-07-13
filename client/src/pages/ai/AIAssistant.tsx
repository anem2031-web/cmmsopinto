import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Brain, Send, Loader2, Sparkles, Trash2, Bot, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Streamdown } from "streamdown";
import { useTranslation } from "@/contexts/LanguageContext";
import { useLanguage } from "@/contexts/LanguageContext";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export default function AIAssistant() {
  const { t: tr } = useLanguage();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const askMut = trpc.ai.analyze.useMutation({
    onSuccess: (data) => {
      const answer = typeof data.answer === "string" ? data.answer : JSON.stringify(data.answer);
      setMessages(prev => [...prev, { role: "assistant", content: answer, timestamp: new Date() }]);
      setIsLoading(false);
    },
    onError: (err: { message: string }) => {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}`, timestamp: new Date() }]);
      setIsLoading(false);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleAsk = () => {
    if (!query.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: query.trim(), timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setQuery("");
    setIsLoading(true);

    // إرسال آخر 10 رسائل كسجل محادثة
    const history = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    askMut.mutate({
      question: query.trim(),
      conversationHistory: history.slice(0, -1), // exclude current question
    });
  };

  const clearChat = () => {
    setMessages([]);
    setQuery("");
  };

  const isRtl = language === "ar" || language === "ur";

  // اقتراحات متعددة اللغات
  const suggestions = language === "en" ? [
    "How many open tickets do we have?",
    "Show me low stock inventory items",
    "What's the total maintenance cost?",
    "Summarize purchase orders status",
    "Who has the most assigned tickets?",
    "Suggest a preventive maintenance plan",
  ] : language === "ur" ? [
    "کتنے کھلے بلاغات ہیں؟",
    "کم اسٹاک والی اشیاء دکھائیں",
    "کل دیکھ بھال کی لاگت کیا ہے؟",
    "خریداری کے احکامات کی حالت بتائیں",
  ] : [
    "كم عدد البلاغات المفتوحة؟",
    "وش الأصناف اللي مخزونها قليل؟",
    "ايه البلاغات الحرجة دي؟",
    "كم تكلفة الصيانة الإجمالية؟",
    "مين الفني اللي عنده أكثر بلاغات؟",
    "اقترح خطة صيانة وقائية",
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t.nav.aiAssistant}</h1>
            <p className="text-xs text-muted-foreground">
              {language === "en" ? "Ask anything about the system data" :
               language === "ur" ? "سسٹم ڈیٹا کے بارے میں کچھ بھی پوچھیں" :
               "اسأل أي سؤال عن بيانات النظام"}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="text-muted-foreground hover:text-destructive gap-1.5">
            <Trash2 className="w-4 h-4" />
            {language === "en" ? "Clear" : language === "ur" ? "صاف" : "مسح"}
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {language === "en" ? "Smart Maintenance Assistant" :
               language === "ur" ? "سمارٹ دیکھ بھال اسسٹنٹ" :
               "مساعد الصيانة الذكي"}
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              {language === "en"
                ? "I have full access to the system database. Ask me about tickets, purchase orders, inventory, users, costs, or anything else!"
                : language === "ur"
                ? "میرے پاس سسٹم ڈیٹا بیس تک مکمل رسائی ہے۔ بلاغات، خریداری کے احکامات، انوینٹری، صارفین، اخراجات، یا کسی بھی چیز کے بارے میں پوچھیں!"
                : "عندي وصول كامل لقاعدة بيانات النظام. اسألني عن البلاغات، طلبات الشراء، المخزون، المستخدمين، التكاليف، أو أي شيء ثاني!"}
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="text-xs h-auto py-2 px-3 rounded-full"
                  onClick={() => { setQuery(s); inputRef.current?.focus(); }}
                >
                  <Sparkles className="w-3 h-3 shrink-0" />
                  <span className={isRtl ? "mr-1" : "ml-1"}>{s}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? (isRtl ? "flex-row-reverse" : "flex-row") : ""}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}>
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`flex-1 min-w-0 ${msg.role === "user" ? (isRtl ? "text-right" : "text-left") : ""}`}>
                  {msg.role === "user" ? (
                    <div className={`inline-block rounded-2xl px-4 py-2.5 bg-primary text-primary-foreground max-w-[85%] ${
                      isRtl ? "rounded-tl-sm" : "rounded-tr-sm"
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ) : (
                    <Card className="p-4 border-0 bg-muted/50 max-w-[95%]">
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <Streamdown>{msg.content}</Streamdown>
                      </div>
                    </Card>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1 px-1">
                    {msg.timestamp.toLocaleTimeString(language === "en" ? "en-US" : language === "ur" ? "ur-PK" : "ar-SA", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <Card className="p-4 border-0 bg-muted/50">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">
                      {language === "en" ? "Analyzing data..." :
                       language === "ur" ? "ڈیٹا کا تجزیہ ہو رہا ہے..." :
                       "جاري تحليل البيانات..."}
                    </span>
                  </div>
                </Card>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-border pt-3 pb-1">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              rows={1}
              className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] max-h-[120px]"
              style={{ direction: isRtl ? "rtl" : "ltr" }}
              placeholder={
                language === "en" ? "Ask me anything about the system..." :
                language === "ur" ? "سسٹم کے بارے میں کچھ بھی پوچھیں..." :
                "اسألني أي سؤال عن النظام... (يدعم اللهجة السعودية والمصرية)"
              }
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 120) + "px";
              }}
            />
          </div>
          <Button
            onClick={handleAsk}
            disabled={isLoading || !query.trim()}
            size="icon"
            className="h-[44px] w-[44px] rounded-xl shrink-0"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          {language === "en" ? "Supports: English, Arabic (Saudi/Egyptian dialects), Urdu" :
           language === "ur" ? "معاونت: انگریزی، عربی (سعودی/مصری لہجے)، اردو" :
           "يدعم: العربية (فصحى + سعودي + مصري) • English • اردو"}
        </p>
      </div>
    </div>
  );
}
