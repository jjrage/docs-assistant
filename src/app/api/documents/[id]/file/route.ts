import { readableDocument, signedFileUrl } from "@/server/documents/access";

/** The document's file, for the viewer: a redirect to a signed URL valid for a minute. */
export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await params;
  const doc = await readableDocument(id);
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  const url = await signedFileUrl(doc.storagePath);
  if (!url) return Response.json({ error: "file unavailable" }, { status: 502 });
  return Response.redirect(url, 302);
}
