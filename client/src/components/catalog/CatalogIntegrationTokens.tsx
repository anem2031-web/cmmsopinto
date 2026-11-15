import { useId, useState, type FormEvent } from "react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTranslation } from "@/contexts/LanguageContext";
import { catalogIntegrationText } from "@/i18n/catalogIntegration";
import { trpc } from "@/lib/trpc";

export default function CatalogIntegrationTokens() {
  const { t, language, dir } = useTranslation();
  const text = catalogIntegrationText[language];
  const nameId = useId();
  const tokenId = useId();
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const utils = trpc.useUtils();
  const tokens = trpc.catalogIntegrationTokens.list.useQuery();
  const create = trpc.catalogIntegrationTokens.create.useMutation({ gcTime: 0 });
  const revoke = trpc.catalogIntegrationTokens.revoke.useMutation({
    onSuccess: () => {
      setSelected(null);
      void utils.catalogIntegrationTokens.list.invalidate();
      toast.success(text.revokeSuccess);
    },
    onError: () => toast.error(text.revokeFailed),
  });
  const dateFormat = new Intl.DateTimeFormat(language, {
    calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
  });

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applicationName = name.trim();
    if (!applicationName || create.isPending) return;
    try {
      const { token } = await create.mutateAsync({ name: applicationName });
      setIssuedToken(token);
      setName("");
      void utils.catalogIntegrationTokens.list.invalidate();
    } catch {
      toast.error(text.createFailed);
    } finally {
      // Keep the one-time token solely in component state while the dialog is open.
      create.reset();
    }
  }

  async function copyToken() {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      toast.success(text.copied);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-5" />
          {text.title}
        </CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={createToken} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-full space-y-2 sm:max-w-sm">
            <Label htmlFor={nameId}>{text.programName}</Label>
            <Input
              id={nameId}
              dir="auto"
              value={name}
              maxLength={100}
              onChange={event => setName(event.currentTarget.value)}
              required
            />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? t.common.saving : text.create}
          </Button>
        </form>

        {tokens.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : tokens.isError ? (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="text-sm text-destructive">{text.loadFailed}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void tokens.refetch()}>
              {t.common.refresh}
            </Button>
          </div>
        ) : !tokens.data?.length ? (
          <p className="text-sm text-muted-foreground">{text.listEmpty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="text-start">{text.programName}</TableHead>
                <TableHead scope="col" className="text-start">{t.common.status}</TableHead>
                <TableHead scope="col" className="text-start">{text.createdAt}</TableHead>
                <TableHead scope="col" className="text-start">{text.revokedAt}</TableHead>
                <TableHead scope="col" className="text-start">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map(token => (
                <TableRow key={token.id}>
                  <TableCell className="max-w-64 whitespace-normal break-words"><bdi>{token.name}</bdi></TableCell>
                  <TableCell>{token.revokedAt ? text.revoked : text.active}</TableCell>
                  <TableCell>{dateFormat.format(new Date(token.createdAt))}</TableCell>
                  <TableCell>{token.revokedAt ? dateFormat.format(new Date(token.revokedAt)) : "—"}</TableCell>
                  <TableCell>
                    {!token.revokedAt && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected({ id: token.id, name: token.name })}
                      >
                        {text.revoke}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={issuedToken !== null} onOpenChange={open => { if (!open) setIssuedToken(null); }}>
        <DialogContent dir={dir} showCloseButton={false}>
          <DialogHeader className="text-start">
            <DialogTitle>{text.tokenCreated}</DialogTitle>
            <DialogDescription>{text.copyBeforeClosing}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={tokenId}>{text.token}</Label>
            <Input
              id={tokenId}
              dir="ltr"
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={issuedToken ?? ""}
              onFocus={event => event.currentTarget.select()}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssuedToken(null)}>{t.common.close}</Button>
            <Button type="button" onClick={() => void copyToken()}>
              <Copy aria-hidden="true" className="size-4" />{text.copy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={selected !== null} onOpenChange={open => { if (!open && !revoke.isPending) setSelected(null); }}>
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>{text.revoke} · <bdi>{selected?.name}</bdi></AlertDialogTitle>
            <AlertDialogDescription>{text.revokeDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault();
                if (selected && !revoke.isPending) revoke.mutate({ id: selected.id });
              }}
            >
              {text.revoke}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
