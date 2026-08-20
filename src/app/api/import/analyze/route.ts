/**
 * 取り込み前の下見エンドポイント。
 * POST multipart/form-data（`file` 1つ、.xlsx/.xls/.csv）。
 *
 * ファイルを1回だけ解析し、
 *   - 全シートの構造（列・型の当たり・見出し行・結合セル・非表示）
 *   - 「どのシートを、どの項目名で入れるか」の提案
 *   - 人に確認したいこと（結合セル、見出し行のずれ、名前の無い列 …）
 * を返す。**データベースには何も書かない。**
 *
 * 提案は `advice`、その出どころは `via`（"anthropic" | "heuristic"）。
 * APIキーが無い環境でも必ず `advice` は返る（決定的なルールで組み立てる）ので、
 * 画面側は via を気にせず同じように描ける。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { readAllSheets, MAX_IMPORT_BYTES } from "@/lib/excel";
import { adviseImport } from "@/lib/import-advisor";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_LABEL = "15MB";

export const POST = withAuth(async (req, { user }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(
      "ファイルを読み取れませんでした。もう一度アップロードしてください。",
      400,
    );
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new ApiError("ファイルが指定されていません", 400);
  }

  const name = file.name ?? "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError("対応形式は .xlsx / .xls / .csv です", 415);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(
      `ファイルサイズが上限（${MAX_LABEL}）を超えています`,
      413,
    );
  }

  const buffer = await file.arrayBuffer();
  const sheets = readAllSheets(buffer);

  if (sheets.every((s) => s.empty)) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  const { advice, via } = await adviseImport(sheets);

  /*
   * 同じ名前のファイルが既に入っていないかを見る。
   *
   * 毎月同じ台帳を入れ直すのが普通の使い方なのに、これまでは入れるたびに
   * 「売上台帳」が増え、シートもダッシュボードも同名で並んでいた。名前が同じ
   * ものは見分けが付かないので、どれが最新か分からなくなる。
   * ここでは判定材料を返すだけで、上書きするかどうかは利用者が選ぶ。
   */
  const fileBase = name.replace(/\.[^.]+$/, "").trim();
  const found = fileBase
    ? await db.workbook.findFirst({
        where: { workspaceId: user.workspace.id, name: fileBase },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          createdAt: true,
          collections: {
            orderBy: { position: "asc" },
            select: {
              name: true,
              slug: true,
              _count: { select: { records: true } },
            },
          },
        },
      })
    : null;

  return ok({
    fileName: name,
    fileBase,
    sheets,
    advice,
    via,
    existing: found
      ? {
          workbookId: found.id,
          name: found.name,
          importedAt: found.createdAt.toISOString(),
          sheets: found.collections.map((c) => ({
            name: c.name,
            slug: c.slug,
            rowCount: c._count.records,
          })),
        }
      : null,
  });
});
