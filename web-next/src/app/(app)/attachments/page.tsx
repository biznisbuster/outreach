import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/core/utils";
import { Paperclip, Upload, Download, Trash2 } from "lucide-react";
import { deleteAttachmentAction } from "./actions";

export const dynamic = "force-dynamic";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AttachmentsPage() {
  const db = getDb();
  const attachments = db.select().from(schema.attachments).all();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attachments</h1>
        <p className="text-sm text-muted-foreground">Biblioteka email attachment-a (dedup po SHA-256)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>PDF, slike i dokumenti do 10 MB</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/attachments" method="POST" encType="multipart/form-data" className="flex gap-2">
            <Input name="file" type="file" required className="flex-1" />
            <Button type="submit">
              <Upload /> Otpremi
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-4 text-muted-foreground" /> Fajlovi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {attachments.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nema attachment-a" description="Otpremi prvi fajl koji će se kačiti na email šablone." />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.originalName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(a.size)} · {a.mimeType} · {formatDate(a.uploadedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/attachments/${a.id}/file`} download={a.originalName}>
                        <Download /> Preuzmi
                      </a>
                    </Button>
                    <form action={deleteAttachmentAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" variant="ghost" size="icon" aria-label="Obriši attachment">
                        <Trash2 />
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
