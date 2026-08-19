/**
 * Single field endpoint (scoped through the owning collection).
 * PATCH  — update name / type / required / options / position. A type change
 *          re-coerces the stored values and drops the old config.
 * DELETE — remove the field, after refusing when other columns depend on it,
 *          and after erasing its values from every row.
 */
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { fieldInputSchema } from "@/lib/validation";
import { getCollectionForUser } from "@/lib/workspace";
import { validateFieldConfig, type EngineField } from "@/lib/relations";
import {
  FIELD_TYPE_META,
  coerceValue,
  isComputedField,
  isFieldType,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import { parseFormula } from "@/lib/formula";
import { Prisma } from "@prisma/client";

// Partial variant — any subset of field attributes may be updated.
const updateFieldSchema = fieldInputSchema.partial();

/** 1回の書き戻しでまとめて更新する行数。SQLite でも重くなりすぎない粒度。 */
const WRITE_CHUNK = 200;
/** 行の書き戻し＋メタ更新をまとめるトランザクションの上限時間（ミリ秒）。 */
const TX_TIMEOUT_MS = 120_000;

/** JSON から文字列だけを安全に取り出す（設定は利用者由来なので型を信用しない）。 */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

interface RecordWrite {
  id: string;
  data: Record<string, unknown>;
}

/**
 * この列に依存している他の列。
 * - "via"   … ルックアップ／ロールアップが「リンク列」として使っている
 * - "value" … 保存値そのものを読んでいる（vlookup のキー列・参照列など）
 */
interface Dependent {
  kind: "via" | "value";
  collectionName: string;
  fieldName: string;
}

/** 「顧客DBの「金額」」のような日本語の列挙にする（多すぎる場合は先頭のみ）。 */
function describeDependents(deps: Dependent[]): string {
  const head = deps
    .slice(0, 5)
    .map((d) => `${d.collectionName}の「${d.fieldName}」`)
    .join("、");
  return deps.length > 5 ? `${head} ほか${deps.length - 5}件` : head;
}

/**
 * ワークスペース全体を走査して、この列に依存している列を集める。
 *
 * 【不具合の再発防止】以前は依存関係を一切見ずに列を消していたため、
 * ルックアップ／ロールアップの参照元リンク列、計算式が参照している列、
 * vlookup の突合キーや参照列を削除すると、それらの列が警告もないまま
 * 永久に空欄になっていた。削除・型変更の前にここで気付けるようにする。
 */
async function findDependents(
  workspaceId: string,
  collectionId: string,
  fieldId: string,
  key: string,
): Promise<Dependent[]> {
  const rows = await db.field.findMany({
    where: { collection: { workspaceId } },
    select: {
      id: true,
      key: true,
      name: true,
      type: true,
      config: true,
      collectionId: true,
      collection: { select: { name: true } },
    },
  });

  // リンク列（relation）の「どのシートを指しているか」を先に索引化する。
  // 他シートのルックアップがこのシートの列を参照しているかは、これが無いと
  // 判定できない。
  const relationTargets = new Map<string, Map<string, string>>();
  for (const f of rows) {
    if (f.type !== "relation") continue;
    const target = str((f.config as { targetCollectionId?: unknown } | null)?.targetCollectionId);
    if (!target) continue;
    const perCollection = relationTargets.get(f.collectionId) ?? new Map<string, string>();
    perCollection.set(f.key, target);
    relationTargets.set(f.collectionId, perCollection);
  }

  const deps: Dependent[] = [];
  for (const f of rows) {
    if (f.id === fieldId) continue;
    const cfg = (f.config ?? {}) as Record<string, unknown>;
    const sameCollection = f.collectionId === collectionId;
    const push = (kind: Dependent["kind"]) =>
      deps.push({ kind, collectionName: f.collection.name, fieldName: f.name });

    if (f.type === "lookup" || f.type === "rollup") {
      if (sameCollection && str(cfg.via) === key) {
        push("via");
        continue;
      }
      // 他シートから「リンク先の列」として参照されている場合。
      const via = relationTargets.get(f.collectionId)?.get(str(cfg.via));
      if (via === collectionId && str(cfg.target) === key) push("value");
    } else if (f.type === "vlookup") {
      if (sameCollection && str(cfg.localKey) === key) {
        push("value");
        continue;
      }
      if (
        str(cfg.targetCollectionId) === collectionId &&
        (str(cfg.targetKey) === key || str(cfg.targetField) === key)
      ) {
        push("value");
      }
    } else if (f.type === "formula" && sameCollection) {
      const parsed = parseFormula(str(cfg.expression));
      if (parsed.ok && parsed.refs.includes(key)) push("value");
    }
  }
  return deps;
}

/** 変更のある行だけをまとめて書き戻す。 */
async function applyRecordWrites(
  tx: Prisma.TransactionClient,
  writes: RecordWrite[],
): Promise<void> {
  for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
    const chunk = writes.slice(i, i + WRITE_CHUNK);
    await Promise.all(
      chunk.map((w) =>
        tx.record.update({ where: { id: w.id }, data: { data: toJson(w.data) } }),
      ),
    );
  }
}

/** コレクションの全行を { id, data } で読む。 */
async function loadRows(collectionId: string): Promise<RecordWrite[]> {
  const rows = await db.record.findMany({
    where: { collectionId },
    select: { id: true, data: true },
  });
  return rows.map((r) => ({
    id: r.id,
    data: ((r.data as Record<string, unknown>) ?? {}),
  }));
}

/** 指定キーを保持している行から、そのキーを取り除いた書き戻し計画を作る。 */
function planKeyRemoval(rows: RecordWrite[], key: string): RecordWrite[] {
  const writes: RecordWrite[] = [];
  for (const row of rows) {
    if (!(key in row.data)) continue;
    const next = { ...row.data };
    delete next[key];
    writes.push({ id: row.id, data: next });
  }
  return writes;
}

export const PATCH = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const field = collection.fields.find((f) => f.id === params.fieldId);
  if (!field) throw new ApiError("フィールドが見つかりません。", 404);

  const input = await readJson(req, updateFieldSchema);

  const currentType: FieldType = isFieldType(field.type) ? field.type : "text";
  const nextType: FieldType = input.type ?? currentType;
  const typeChanged = input.type !== undefined && input.type !== field.type;

  const data: Prisma.FieldUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.required !== undefined) data.required = input.required;
  if (input.options !== undefined) data.options = toJson(input.options);
  // 【不具合の再発防止】種類を変えたのに選択肢が残ると、数値列に select の
  // 選択肢がぶら下がったままになる。選択肢を持たない種類へ変えたら消す。
  if (input.options === undefined && typeChanged && !FIELD_TYPE_META[nextType].optioned) {
    data.options = Prisma.DbNull;
  }

  let effectiveConfig: Record<string, unknown> | undefined;
  if (input.config !== undefined || input.type !== undefined) {
    // Re-validate relation/lookup/rollup/vlookup config against the effective
    // type. The collection id lets the vlookup branch reject self-joins.
    //
    // 【不具合の再発防止】種類が変わったときに古い config を引き継いではいけない。
    // relation → text に変えると config 未送信のまま validateFieldConfig を
    // 素通りし、テキスト列にリンク設定が残っていた。種類が変わった場合は
    // 「今回送られてきた config」だけを正とする（必要な設定が無ければ、
    // validateFieldConfig が日本語で不足を知らせる）。
    const baseConfig = typeChanged ? input.config : (input.config ?? field.config);
    effectiveConfig = await validateFieldConfig(
      user.workspace.id,
      nextType,
      baseConfig,
      collection.fields as unknown as EngineField[],
      collection.id,
      field.key,
    );
    data.config = effectiveConfig ? toJson(effectiveConfig) : Prisma.DbNull;
  }

  let writes: RecordWrite[] = [];
  let convertedCount = 0;

  if (typeChanged) {
    // 依存している列が壊れる変更は受け付けない。
    const deps = await findDependents(
      user.workspace.id,
      collection.id,
      field.id,
      field.key,
    );
    const broken = deps.filter(
      (d) =>
        (d.kind === "via" && nextType !== "relation") ||
        (d.kind === "value" && isComputedField(nextType)),
    );
    if (broken.length > 0) {
      throw new ApiError(
        `項目「${field.name}」の種類を「${FIELD_TYPE_META[nextType].label}」に変更できません。この列は${describeDependents(broken)}から参照されています。先に参照元の設定を変更するか、参照元の列を削除してください。`,
        422,
      );
    }

    const rows = await loadRows(collection.id);

    if (isComputedField(nextType)) {
      // 自動計算の列は保存値を読まない。残しておくと、後で普通の列に戻した
      // ときに古い値が復活するので、ここで消す。
      writes = planKeyRemoval(rows, field.key);
      convertedCount = writes.length;
    } else {
      // 【不具合の再発防止】以前は種類だけ書き換えて保存値を放置していたため、
      // 数値列に "h" が入ったままになるなど、型と中身が食い違っていた。
      // 新しい種類で解釈し直し、解釈できない値が1件でもあれば変更を中止して
      // 「どの列の、どんな値が引っかかったか」を知らせる。
      const options =
        (input.options as SelectOption[] | undefined) ??
        ((field.options as SelectOption[] | null) ?? undefined);
      const rejected: unknown[] = [];
      const converted: RecordWrite[] = [];
      const coerced: unknown[] = [];
      for (const row of rows) {
        const raw = row.data[field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        const result = coerceValue(nextType, raw, options);
        if (!result.ok) {
          rejected.push(raw);
          continue;
        }
        coerced.push(result.value);
        if (JSON.stringify(result.value) === JSON.stringify(raw)) continue;
        converted.push({ id: row.id, data: { ...row.data, [field.key]: result.value } });
      }
      if (rejected.length > 0) {
        throw new ApiError(
          `項目「${field.name}」の種類を「${FIELD_TYPE_META[nextType].label}」に変更できません。既存データに${FIELD_TYPE_META[nextType].label}として扱えない値が${rejected.length}件あります（例：「${String(rejected[0])}」）。該当セルを空にするか修正してから、種類を変更してください。`,
          422,
        );
      }
      if (nextType === "relation") {
        // テキスト等をリンク列に変えると、既存の文字列がそのままリンクIDとして
        // 保存され、どこも指さないリンクだらけになる。実在するレコードを
        // 指していない値が残っていないか、ここで確かめる。
        const ids = new Set<string>();
        for (const value of coerced) {
          if (Array.isArray(value)) for (const v of value) ids.add(String(v));
        }
        const targetCollectionId = str(effectiveConfig?.targetCollectionId);
        const found =
          ids.size === 0
            ? 0
            : await db.record.count({
                where: {
                  id: { in: [...ids] },
                  collection: { id: targetCollectionId, workspaceId: user.workspace.id },
                },
              });
        if (found !== ids.size) {
          throw new ApiError(
            `項目「${field.name}」の種類を「${FIELD_TYPE_META.relation.label}」に変更できません。既存の値のうち${ids.size - found}件はリンク先のレコードとして見つかりません。列を空にしてから種類を変更し、改めてリンクを選び直してください。`,
            422,
          );
        }
      }
      writes = converted;
      convertedCount = converted.length;
    }
  }

  if (input.position !== undefined) data.position = input.position;

  // 保存値の書き換えと種類の更新は必ず一括で行う。片方だけ通ると、まさに
  // 直したかった「型と中身の食い違い」がそのまま残ってしまう。
  const updated =
    writes.length > 0
      ? await db.$transaction(
          async (tx) => {
            await applyRecordWrites(tx, writes);
            return tx.field.update({ where: { id: field.id }, data });
          },
          { timeout: TX_TIMEOUT_MS },
        )
      : await db.field.update({ where: { id: field.id }, data });

  // 何行が入れ替わったかを返す（画面が「N件のデータを変換しました」と出せる）。
  return ok({ ...updated, convertedRecordCount: convertedCount });
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const field = collection.fields.find((f) => f.id === params.fieldId);
  if (!field) throw new ApiError("項目が見つかりません（削除された可能性があります）。", 404);

  const deps = await findDependents(
    user.workspace.id,
    collection.id,
    field.id,
    field.key,
  );
  if (deps.length > 0) {
    throw new ApiError(
      `項目「${field.name}」は${describeDependents(deps)}から参照されているため削除できません。先に参照している列を削除するか、参照先を変更してください。`,
      422,
    );
  }

  // 【不具合の再発防止】以前は行データを残したまま列だけ消していた。項目キーは
  // 「現存する項目」としか重複を避けないため、同じ名前の項目を作り直すと同じ
  // キーが再利用され、古い値が別の種類の列に復活していた（金額/数値を消して
  // 金額/テキストで作り直すと、以前の数値がそのまま出てくる）。列を消すときは
  // その列の値も消す。
  const writes = planKeyRemoval(await loadRows(collection.id), field.key);
  await db.$transaction(
    async (tx) => {
      await applyRecordWrites(tx, writes);
      await tx.field.delete({ where: { id: field.id } });
    },
    { timeout: TX_TIMEOUT_MS },
  );

  return ok({ id: field.id, clearedRecordCount: writes.length });
});
