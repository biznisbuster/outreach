import { getAllSettings, groupSettings } from "@/core/settings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { saveSettings } from "./actions";
import { Save } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { groups } = groupSettings(getAllSettings());

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Podešavanja</h1>
        <p className="text-sm text-muted-foreground">DB-backed podešavanja (DB → env → default)</p>
      </div>

      <form action={saveSettings} className="space-y-6">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
              {g.description && <CardDescription>{g.description}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-4">
              {g.items.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`set-${s.key}`} className="text-sm">
                      {s.def.label ?? s.key}
                    </Label>
                    {s.isSet && <Badge variant="outline">custom</Badge>}
                    {s.isSecret && <Badge variant="secondary">secret</Badge>}
                  </div>
                  {s.def.description && <p className="text-xs text-muted-foreground">{s.def.description}</p>}
                  <input type="hidden" name="keys" value={s.key} />
                  <Input
                    id={`set-${s.key}`}
                    name="values"
                    type={s.isSecret ? "password" : "text"}
                    defaultValue={s.value}
                    autoComplete="off"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        <Button type="submit" size="lg" className="w-full">
          <Save /> Sačuvaj podešavanja
        </Button>
      </form>
    </div>
  );
}
