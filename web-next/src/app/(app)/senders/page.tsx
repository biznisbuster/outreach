import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/core/utils";
import { createSender, toggleSender, deleteSender } from "./actions";
import { Send, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SendersPage() {
  const db = getDb();
  const senders = db.select().from(schema.senders).all();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Senderi</h1>
        <p className="text-sm text-muted-foreground">SMTP nalozi za slanje emailova</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {senders.length === 0 && (
            <EmptyState title="Nema sendera" description="Dodaj SMTP nalog da bi mogao da šalješ emailove." />
          )}
          {senders.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
                    <Send className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.fromName}</div>
                    <div className="truncate text-sm text-muted-foreground">{s.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.smtpHost}:{s.smtpPort} · cap {s.dailyCap}/dan, {s.hourlyCap}/h
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={s.active ? "success" : "secondary"}>{s.active ? "Aktivan" : "Pauziran"}</Badge>
                  <form action={toggleSender}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {s.active ? "Pauziraj" : "Aktiviraj"}
                    </Button>
                  </form>
                  <form action={deleteSender}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="ghost" size="icon" aria-label="Obriši sendera">
                      <Trash2 />
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Dodaj sendera</CardTitle>
            <CardDescription>SMTP kredencijali se enkriptuju (AES-256-GCM)</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createSender} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fromName">Ime pošiljaoca</Label>
                <Input id="fromName" name="fromName" placeholder="Marko Marković" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email adresa</Label>
                <Input id="email" name="email" type="email" required placeholder="marko@tvojdomen.rs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="smtpHost">SMTP host</Label>
                  <Input id="smtpHost" name="smtpHost" required placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtpPort">Port</Label>
                  <Input id="smtpPort" name="smtpPort" type="number" defaultValue={587} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" name="username" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Lozinka / app password</Label>
                <Input id="password" name="password" type="password" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dailyCap">Dnevni cap</Label>
                  <Input id="dailyCap" name="dailyCap" type="number" defaultValue={50} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hourlyCap">Satni cap</Label>
                  <Input id="hourlyCap" name="hourlyCap" type="number" defaultValue={10} />
                </div>
              </div>
              <Button type="submit" className="w-full">
                Dodaj sendera
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
