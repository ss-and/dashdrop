/**
 * Global search across the workspace.
 * GET /api/search?q=... → {
 *   query, groups: [{ collectionId, collectionName, slug, icon, isCrm,
 *                     hits: [{ recordId, title, subtitle }], more }],
 *   objects:  [{ id, name, slug, icon, kind: "crm" | "sheet" }],
 *   files:    [{ id, name }],
 *   dashboards: [{ id, name }],
 *   more:  { objects, files, dashboards },   // 上限で切ったか
 *   scope: { rowsPerCollection, collections, computedFields }  // 何を見たか
 * }
 *
 * Records are matched by scanning each collection's rows in memory: row data is
 * JSON, and SQLite can't portably index into it. To stay fast we cap how many
 * rows we scan per collection and stop once we have enough hits — good enough
 * for SMB-sized workspaces and never a cross-tenant risk (everything is scoped
 * to the caller's workspace).
 *
 * 打ち切りは黙って行わない。何件で切ったか・何を見ていないかを `more` と
 * `scope` で返し、画面がそのまま利用者に伝える（「無い」と「これ以上は
 * 見ていない」は別物なので）。
 *
 * 名前の一致（シート・ファイル・ダッシュボード）は DB 側で絞って上限を付ける。
 * 以前は全件を取り出してメモリで filter しており、シートが1万枚あるワーク
 * スペースでは1打鍵ごとに全件を読み出していた。
 */
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { isComputedField } from "@/lib/field-types";
import { isCrmSlug } from "@/lib/crm-objects";
import {
  matchRecord,
  prepareField,
  renderValue,
} from "@/components/search/match";

/** Rows scanned per collection. */
const SCAN_LIMIT = 400;
/** Hits kept per collection. */
const HITS_PER_COLLECTION = 5;
/** Collections searched (CRM objects first, so they win the budget). */
const MAX_COLLECTIONS = 24;
/** 名前一致（シート/ファイル/ダッシュボード）の表示件数。 */
const NAME_LIMIT = 8;
/**
 * 走査の対象にするコレクションを選ぶために読む件数。
 * MAX_COLLECTIONS より多めに読むのは、CRM を先頭へ並べ替える余地を残すため。
 */
const COLLECTION_POOL = 200;

interface Hit {
  recordId: string;
  title: string;
  subtitle: string;
}

export const GET = withAuth(async (req, { user }) => {
  const workspaceId = user.workspace.id;
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").trim();

  const empty = {
    query: "",
    groups: [],
    objects: [],
    files: [],
    dashboards: [],
    more: { objects: false, files: false, dashboards: false },
    scope: {
      rowsPerCollection: SCAN_LIMIT,
      collections: MAX_COLLECTIONS,
      computedFields: false,
    },
  };
  if (raw.length === 0) return ok(empty);

  const q = raw.toLowerCase();

  // 上限+1件だけ取り、あふれたかどうかを見てから切る。
  // SQLite の LIKE は ASCII の大文字小文字を区別しないので `contains` で足りる
  // （日本語はもともと区別が無い）。Postgres へ移すときはここだけ
  // `mode: "insensitive"` が要る。
  const nameQuery = { contains: raw };
  const [matchedCollections, matchedWorkbooks, matchedDashboards, pool] =
    await Promise.all([
      db.collection.findMany({
        where: { workspaceId, name: nameQuery },
        orderBy: { position: "asc" },
        take: NAME_LIMIT + 1,
        select: { id: true, name: true, slug: true, icon: true },
      }),
      db.workbook.findMany({
        where: { workspaceId, name: nameQuery },
        orderBy: { createdAt: "desc" },
        take: NAME_LIMIT + 1,
        select: { id: true, name: true },
      }),
      db.dashboard.findMany({
        where: { workspaceId, name: nameQuery },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: NAME_LIMIT + 1,
        select: { id: true, name: true },
      }),
      // 走査の対象を選ぶための軽い一覧（フィールドはまだ読まない）。
      db.collection.findMany({
        where: { workspaceId },
        orderBy: { position: "asc" },
        take: COLLECTION_POOL,
        select: { id: true, name: true, slug: true, icon: true },
      }),
    ]);

  // --- Name matches (objects / files / dashboards) --------------------------
  const objects = matchedCollections.slice(0, NAME_LIMIT).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    kind: isCrmSlug(c.slug) ? ("crm" as const) : ("sheet" as const),
  }));
  const files = matchedWorkbooks.slice(0, NAME_LIMIT);
  const dashHits = matchedDashboards.slice(0, NAME_LIMIT);
  const more = {
    objects: matchedCollections.length > NAME_LIMIT,
    files: matchedWorkbooks.length > NAME_LIMIT,
    dashboards: matchedDashboards.length > NAME_LIMIT,
  };

  // --- Record matches -------------------------------------------------------
  // CRM objects first so the customer database dominates the results.
  const ordered = [
    ...pool.filter((c) => isCrmSlug(c.slug)),
    ...pool.filter((c) => !isCrmSlug(c.slug)),
  ].slice(0, MAX_COLLECTIONS);

  // 走査するコレクションのフィールドだけをまとめて読む（1件ずつ引くと N+1）。
  const fieldRows = ordered.length
    ? await db.field.findMany({
        where: { collectionId: { in: ordered.map((c) => c.id) } },
        orderBy: { position: "asc" },
        select: {
          collectionId: true,
          key: true,
          name: true,
          type: true,
          options: true,
        },
      })
    : [];
  const fieldsByCollection = new Map<string, typeof fieldRows>();
  for (const f of fieldRows) {
    const list = fieldsByCollection.get(f.collectionId);
    if (list) list.push(f);
    else fieldsByCollection.set(f.collectionId, [f]);
  }

  const groups: Array<{
    collectionId: string;
    collectionName: string;
    slug: string;
    icon: string;
    isCrm: boolean;
    hits: Hit[];
    /** 上限で切ったため、この表にはまだ一致が残っているかもしれない。 */
    more: boolean;
  }> = [];

  for (const c of ordered) {
    const raws = fieldsByCollection.get(c.id) ?? [];
    // 計算列（数式・VLOOKUP・ルックアップ・ロールアップ）は保存されていない。
    // 1行ずつ計算し直すと1打鍵ごとに全表を再計算することになるので対象外にし、
    // 対象外であることを scope.computedFields で画面に伝える。
    const searchable = raws
      .filter((f) => !isComputedField(f.type))
      .map(prepareField);
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
    let capped = false;
    for (const r of rows) {
      const data = (r.data as Record<string, unknown>) ?? {};
      const matchedLabel = matchRecord(searchable, data, q);
      if (!matchedLabel) continue;

      if (hits.length >= HITS_PER_COLLECTION) {
        // これ以上は出さないが、「まだある」ことは伝える。
        capped = true;
        break;
      }

      // 見出しも画面と同じ見え方にする（選択肢はコードではなくラベル）。
      const title = renderValue(titleField, data[titleField.key]) || "（無題）";

      hits.push({ recordId: r.id, title, subtitle: matchedLabel });
    }

    if (hits.length > 0) {
      groups.push({
        collectionId: c.id,
        collectionName: c.name,
        slug: c.slug,
        icon: c.icon,
        isCrm: isCrmSlug(c.slug),
        hits,
        // 走査を上限で打ち切った表も「まだあるかもしれない」に含める。
        more: capped || rows.length >= SCAN_LIMIT,
      });
    }
  }

  return ok({
    query: raw,
    groups,
    objects,
    files,
    dashboards: dashHits,
    more,
    scope: {
      rowsPerCollection: SCAN_LIMIT,
      collections: MAX_COLLECTIONS,
      /** 計算列は検索していない。 */
      computedFields: false,
    },
  });
});
