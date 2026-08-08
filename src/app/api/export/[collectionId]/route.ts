/**
 * Collection export endpoint.
 * GET /api/export/:collectionId — streams the collection back as an .xlsx file.
 *
 * Tenant-safe via getCollectionForUser (throws 404 across workspaces). The
 * DataGrid page links here for its "download" action.
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { getCollectionForUser } from "@/lib/workspace";
import { buildExportWorkbook, type ExportField } from "@/lib/excel";
import { isFieldType, type FieldType } from "@/lib/field-types";

export const GET = withAuth(async (_req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.collectionId);

  const records = await db.record.findMany({
    where: { collectionId: collection.id },
    orderBy: { createdAt: "asc" },
    select: { data: true },
  });

  const fields: ExportField[] = collection.fields.map((f) => ({
    key: f.key,
    name: f.name,
    type: (isFieldType(f.type) ? f.type : "text") as FieldType,
  }));

  const buffer = buildExportWorkbook(collection.name, fields, records);

  // RFC5987: ascii fallback via slug + UTF-8 encoded Japanese name.
  const asciiName = `${collection.slug || "export"}.xlsx`;
  const utf8Name = encodeURIComponent(`${collection.name}.xlsx`);
  const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
});
