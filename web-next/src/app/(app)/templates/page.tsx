import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/core/utils";
import { saveTemplate, deleteTemplate } from "./actions";
import { FileText, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

const TYPES = [
  { value: "email_personalization", label: "Email personalizacija" },
  { value: "score", label: "Ocena sajta" },
  { value: "seo_summary", label: "SEO rezime" },
  { value: "assistant", label: "Asistent" },
];

export default async function TemplatesPage() {
  const db = getDb();
  const templates = db.select().from(schema.promptTemplates).all();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Šabloni</h1>
        <p className="text-sm text-muted-foreground">Prompt šabloni za AI personalizaciju</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {templates.length === 0 && (
            <EmptyState title="Nema šablona" description="Kreiraj prvi prompt šablon za AI personalizaciju emailova." />
          )}
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">Ažuriran {formatDate(t.updatedAt)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{TYPES.find((x) => x.value === t.type)?.label ?? t.type}</Badge>
                    {t.isDefault && <Badge variant="default">Default</Badge>}
                    <form action={deleteTemplate}>
                      <input type="hidden" name="id" value={t.id} />
                      <Button type="submit" variant="ghost" size="icon" aria-label="Obriši šablon">
                        <Trash2 />
                      </Button>
                    </form>
                  </div>
                </div>
                <form action={saveTemplate} className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="type" value={t.type} />
                  <input type="hidden" name="name" value={t.name} />
                  <Textarea name="body" defaultValue={t.body} rows={4} className="font-mono text-xs" />
                  <Button type="submit" size="sm" variant="outline">
                    Sačuvaj izmene
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Novi šablon</CardTitle>
            <CardDescription> Koristi promenljive poput {"{{ime}}"}, {"{{grad}}"} u telu</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveTemplate} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Naziv</Label>
                <Input id="name" name="name" required placeholder="Personalizacija za zubare" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">Tip</Label>
                <Select id="type" name="type" defaultValue="email_personalization">
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="body">Telo prompta</Label>
                <Textarea id="body" name="body" required rows={8} className="font-mono text-xs" />
              </div>
              <Button type="submit" className="w-full">
                Kreiraj šablon
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
