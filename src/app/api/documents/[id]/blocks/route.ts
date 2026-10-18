import { documentBlocks, readableDocument } from "@/server/documents/access";

/** The document's parsed blocks, for showing a Word document (which has no fixed pages) in the viewer. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/documents/[id]/blocks">,
) {
  const { id } = await params;
  const doc = await readableDocument(id);
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  const { storagePath: _path, ...document } = doc;
  return Response.json({ document, blocks: await documentBlocks(id) });
}
