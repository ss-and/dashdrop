/**
 * Record detail page — the Salesforce-style view of ONE row.
 *
 * DashDrop's CRM objects (顧客 / 担当者 / 商談 / 活動) are Collections whose
 * Records link to each other through `relation` fields. This page turns that
 * graph into something you can walk by clicking: a highlights header, the full
 * 詳細 field list (relations rendered as hyperlinks to the linked record), and
 * related lists for every collection that links AT this record.
 *
 * Server component; every query is scoped to the caller's workspace.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCollectionForUser } from "@/lib/workspace";
import {
  applyLookupLabels,
  pickDisplayField,
  resolveCollectionRecords,
  type EngineCollection,
  type EngineField,
} from "@/lib/relations";
import { isComputedField } from "@/lib/field-types";
import { getCrmObject } from "@/lib/crm-objects";
import { Topbar } from "@/components/app/Topbar";
import { RecordHeader } from "@/components/record/RecordHeader";
import { RecordFields } from "@/components/record/RecordFields";
import {
  RelatedList,
  isScanLimited,
  type RelatedListData,
} from "@/components/record/RelatedList";
import {
  recordValueText,
  toIdArray,
  type RecordFieldDef,
} from "@/components/record/RecordValue";
import { RememberVisit } from "@/components/app/RememberVisit";

/** How many related lists / rows per list / highlight fields we render. */
const MAX_RELATED_LISTS = 6;
const MAX_RELATED_ROWS = 8;
const MAX_RELATED_SCAN = 200;
const MAX_HIGHLIGHTS = 4;
const MAX_RELATED_COLUMNS = 5;

type PrismaField = {
  key: string;
  name: string;
  type: string;
  options: unknown;
  config: unknown;
  position: number;
};

function toFieldDef(f: PrismaField): RecordFieldDef {
  return {
    key: f.key,
    name: f.name,
    type: f.type,
    options: f.options,
    config: f.config,
  };
}

/**
 * Columns for a list view of `collection`: the CRM object's curated
 * `listColumns` when it is one of the core objects, otherwise its first few
 * writable fields. `exclude` drops the relation column that points back at the
 * record we're already looking at (it would repeat on every row).
 */
function listColumnsFor(
  slug: string,
  fields: RecordFieldDef[],
  exclude: string[],
  limit: number,
): RecordFieldDef[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const skip = new Set(exclude);
  const crm = getCrmObject(slug);

  let picked: RecordFieldDef[] = [];
  if (crm) {
    picked = crm.listColumns
      .map((k) => byKey.get(k))
      .filter((f): f is RecordFieldDef => Boolean(f) && !skip.has(f!.key));
  }
  if (picked.length === 0) {
    picked = fields.filter((f) => !isComputedField(f.type) && !skip.has(f.key));
  }

  // The display field leads, so the linked primary cell reads as a name.
  const display = pickDisplayField(fields as unknown as EngineField[]);
  if (display && !skip.has(display.key)) {
    const lead = byKey.get(display.key);
    if (lead) picked = [lead, ...picked.filter((f) => f.key !== lead.key)];
  }
  return picked.slice(0, limit);
}

export default async function RecordPage({
  params,
}: {
  params: Promise<{ collectionId: string; recordId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { collectionId, recordId } = await params;

  let collection: Awaited<ReturnType<typeof getCollectionForUser>>;
  try {
    collection = await getCollectionForUser(user, collectionId);
  } catch {
    redirect("/dashboard"); // returns never — collection is assigned past here
  }

  const record = await db.record.findFirst({
    where: { id: recordId, collectionId },
    select: { id: true, data: true },
  });
  if (!record) redirect(`/c/${collectionId}`);

  const workbook = collection.workbookId
    ? await db.workbook.findFirst({
        where: { id: collection.workbookId, workspaceId: user.workspace.id },
        select: { id: true, name: true },
      })
    : null;

  // Resolve this row's lookup/rollup values + labels for its relation links.
  const resolved = await resolveCollectionRecords(
    user.workspace.id,
    collection as unknown as EngineCollection,
    [{ id: record.id, data: (record.data as Record<string, unknown>) ?? {} }],
  );
  const row = resolved.records[0] ?? {
    id: record.id,
    data: {} as Record<string, unknown>,
    computed: {} as Record<string, unknown>,
  };

  // 画面に渡す computed。ルックアップがリンク先の select / multiselect を引いて
  // いるときは、保存値（"parttime"）ではなく選択肢のラベル（「パート・アルバイト」）
  // を見せる。集計・フィルタが読む resolved.records[].computed は生の値のままで、
  // ここで作るのは表示用のコピーだけ。
  const displayComputed = applyLookupLabels(row.computed, resolved.lookupLabels);

  const fields: RecordFieldDef[] = collection.fields.map(toFieldDef);

  /* ------------------------------- title ---------------------------------- */

  const displayField =
    (pickDisplayField(fields as unknown as EngineField[]) as
      | EngineField
      | null) ?? null;
  const titleField =
    (displayField ? fields.find((f) => f.key === displayField.key) : null) ??
    fields.find((f) => f.type === "text") ??
    null;
  const title =
    (titleField ? recordValueText(titleField, row.data).trim() : "") || "無題";

  /* ----------------------------- highlights -------------------------------- */

  const highlights = listColumnsFor(
    collection.slug,
    fields,
    titleField ? [titleField.key] : [],
    MAX_HIGHLIGHTS,
  ).filter((f) => !titleField || f.key !== titleField.key);

  /* ---------------------------- related lists ------------------------------ */

  // Every relation field in the workspace that points AT this collection.
  const incomingFields = await db.field.findMany({
    where: { type: "relation", collection: { workspaceId: user.workspace.id } },
    include: {
      collection: {
        include: { fields: { orderBy: { position: "asc" } } },
      },
    },
  });

  const incoming = incomingFields.filter(
    (f) =>
      ((f.config ?? null) as { targetCollectionId?: string } | null)
        ?.targetCollectionId === collectionId,
  );

  // Label collisions: the same collection may link here through several fields.
  const nameCounts = new Map<string, number>();
  for (const f of incoming) {
    nameCounts.set(
      f.collection.id,
      (nameCounts.get(f.collection.id) ?? 0) + 1,
    );
  }

  const relatedLists: RelatedListData[] = [];
  for (const relField of incoming.slice(0, MAX_RELATED_LISTS)) {
    const child = relField.collection;

    // SQLite/Prisma can't portably index into the JSON payload, so scan a
    // bounded page of the child's rows and match in JS.
    const childRecords = await db.record.findMany({
      where: { collectionId: child.id },
      orderBy: { createdAt: "desc" },
      take: MAX_RELATED_SCAN,
      select: { id: true, data: true },
    });

    const matches = childRecords.filter((r) =>
      toIdArray((r.data as Record<string, unknown>)?.[relField.key]).includes(
        recordId,
      ),
    );
    // 上限まで読めたなら、その先にまだ一致があるかもしれない。matches.length は
    // 「見た範囲での一致数」でしかないので、総数として出させないために
    // 打ち切りの事実をそのまま画面へ渡す（RelatedList が表現を決める）。
    const scanLimited = isScanLimited(childRecords.length, MAX_RELATED_SCAN);
    // 一致ゼロでも、打ち切っているなら「無い」とは言い切れない。ただし
    // このカードは一致した行を並べるものなので、ここでは出さずに畳む。
    // 「一致が無い」ことを断言する文言はどこにも出していない。
    if (matches.length === 0) continue;

    const shown = matches.slice(0, MAX_RELATED_ROWS);
    // Resolve the shown rows so THEIR relation cells show names and link on.
    const childResolved = await resolveCollectionRecords(
      user.workspace.id,
      child as unknown as EngineCollection,
      shown.map((r) => ({
        id: r.id,
        data: (r.data as Record<string, unknown>) ?? {},
      })),
    );

    const childFields: RecordFieldDef[] = child.fields.map(toFieldDef);
    const columns = listColumnsFor(
      child.slug,
      childFields,
      [relField.key],
      MAX_RELATED_COLUMNS,
    );
    if (columns.length === 0) continue;

    relatedLists.push({
      key: `${child.id}:${relField.key}`,
      collectionId: child.id,
      title: child.name,
      subtitle:
        (nameCounts.get(child.id) ?? 0) > 1
          ? `${relField.name} でリンク`
          : undefined,
      total: matches.length,
      scanLimited,
      scanLimit: MAX_RELATED_SCAN,
      columns,
      // 関連リストの行も同じ規則で、ルックアップはラベル表示にそろえる。
      rows: childResolved.records.map((r) => ({
        ...r,
        computed: applyLookupLabels(r.computed, childResolved.lookupLabels),
      })),
      relationLabels: childResolved.relationLabels,
    });
  }

  return (
    <>
      <Topbar user={user} title={title} />
      {/* レコードは「どの表の行か」まで書かないと、履歴で見分けが付かない。 */}
      <RememberVisit
        workspaceId={user.workspace.id}
        kind="record"
        href={`/r/${collection.id}/${record.id}`}
        name={title}
        sub={collection.name}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl animate-fade-in space-y-5">
          <RecordHeader
            title={title}
            collectionId={collection.id}
            collectionName={collection.name}
            collectionIcon={collection.icon}
            workbook={workbook}
            highlights={highlights}
            data={row.data}
            computed={displayComputed}
            relationLabels={resolved.relationLabels}
          />

          <RecordFields
            fields={fields}
            data={row.data}
            computed={displayComputed}
            relationLabels={resolved.relationLabels}
          />

          {relatedLists.map((list) => (
            <RelatedList key={list.key} list={list} />
          ))}
        </div>
      </main>
    </>
  );
}
