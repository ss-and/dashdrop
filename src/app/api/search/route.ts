/**
 * Global search across the workspace.
 * GET /api/search?q=... → {
 *   query, groups: [{ collectionId, collectionName, slug, icon, isCrm,
 *                     hits: [{ recordId, title, subtitle }] }],
 *   objects:  [{ id, name, slug, icon, kind: "crm" | "sheet" }],
 *   files:    [{ id, name }],
 *   dashboards: [{ id, name }]
 * }
 *
 * Records are matched by scanning each collection's rows in memory: row data is
 * JSON, and SQLite can't portably index into it. To stay fast we cap how many
 * rows we scan per collection and stop once we have enough hits — good enough
 * for SMB-sized workspaces and never a cross-tenant risk (everything is scoped
 * to the caller's workspace).
 */
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { displayValue, isComputedField, type FieldType } from "@/lib/field-types";
import { isCrmSlug } from "@/lib/crm-objects";

/** Rows scanned per collection. */
const SCAN_LIMIT = 400;
/** Hits kept per collection. */
const HITS_PER_COLLECTION = 5;
/** Collections searched (CRM objects first, so they win the budget). */
const MAX_COLLECTIONS = 24;

interface Hit {
  recordId: string;
  title: string;
  subtitle: string;
}

export const GET = withAuth(async (req, { user }) => {
  const workspaceId = user.workspace.id;
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").trim();

  if (raw.length === 0) {
    return ok({ query: "", groups: [], objects: [], files: [], dashboards: [] });
  }
  const q = raw.toLowerCase();

  const [collections, workbooks, dashboards] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        fields: {
          orderBy: { position: "asc" },
          select: { key: true, name: true, type: true, options: true },
        },
      },
    }),
    db.workbook.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
    db.dashboard.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
  ]);

  // --- Name matches (objects / files / dashboards) --------------------------
  const objects = collections
    .filter((c) => c.name.toLowerCase().includes(q))
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon,
      kind: isCrmSlug(c.slug) ? ("crm" as const) : ("sheet" as const),
    }));
  const files = workbooks.filter((w) => w.name.toLowerCase().includes(q));
  const dashHits = dashboards.filter((d) => d.name.toLowerCase().includes(q));

  // --- Record matches -------------------------------------------------------
  // CRM objects first so the customer database dominates the results.
  const ordered = [
    ...collections.filter((c) => isCrmSlug(c.slug)),
    ...collections.filter((c) => !isCrmSlug(c.slug)),
  ].slice(0, MAX_COLLECTIONS);

  const groups: Array<{
    collectionId: string;
    collectionName: string;
    slug: string;
    icon: string;
    isCrm: boolean;
    hits: Hit[];
  }> = [];

  for (const c of ordered) {
    const searchable = c.fields.filter((f) => !isComputedField(f.type));
    if (searchable.length === 0) continue;

    const rows = await db.record.findMany({
      where: { collectionId: c.id },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: { id: true, data: true },
    });

    // The field that titles a record: first required field, else first text-ish.
    const titleField =
      searchable.find((f) => f.type === "text") ?? searchable[0];

    const hits: Hit[] = [];
    for (const r of rows) {
      const data = (r.data as Record<string, unknown>) ?? {};
      let matchedLabel: string | null = null;

      for (const f of searchable) {
        const v = data[f.key];
        if (v === null || v === undefined || v === "") continue;
        // Render the value the way the UI shows it, then match on that.
        const opts = f.options as
          | Array<{ label: string; value: string }>
          | null;
        const text = opts
          ? String(
              opts.find((o) => o.value === String(v))?.label ?? v,
            )
          : displayValue(f.type as FieldType, v);
        if (text.toLowerCase().includes(q)) {
          matchedLabel = `${f.name}: ${text}`;
          break;
        }
      }
      if (!matchedLabel) continue;

      const titleRaw = data[titleField.key];
      const title =
        titleRaw === null || titleRaw === undefined || titleRaw === ""
          ? "（無題）"
          : displayValue(titleField.type as FieldType, titleRaw);

      hits.push({ recordId: r.id, title, subtitle: matchedLabel });
      if (hits.length >= HITS_PER_COLLECTION) break;
    }

    if (hits.length > 0) {
      groups.push({
        collectionId: c.id,
        collectionName: c.name,
        slug: c.slug,
        icon: c.icon,
        isCrm: isCrmSlug(c.slug),
        hits,
      });
    }
  }

  return ok({
    query: raw,
    groups,
    objects,
    files,
    dashboards: dashHits,
  });
});
