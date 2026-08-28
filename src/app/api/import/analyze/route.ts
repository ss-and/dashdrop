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
import { adviseImport, advisorCallsOut } from "@/lib/import-advisor";
import { aiAllowedFor } from "@/lib/ai";
import {
  AI_RULE,
  consumeOptional,
  retryMessage,
  workspaceKey,
} from "@/lib/rate-limit";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
/** 利用者に見せる上限の表記。MAX_IMPORT_BYTES と必ず一致させること。 */
const MAX_LABEL = "4MB";

/**
 * 全シートの解析＋ adviseImport（AI が有効なら外部APIへの往復も入る）。
 * ホームの「Excelを置く」の1手目がここなので、宣言が無いと Vercel の既定
 * （10〜15秒）で切られ、製品の入口でいきなり原因不明の失敗になる。
 *
 * 60 は Vercel Pro の最大（800秒）ではなく、Hobby でも他のホスティングでも
 * 通る値。/api/import・/api/import/preview と同じ値でそろえてある。
 */
export const maxDuration = 60;

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
    // 断るだけでは次の一手が分からない。何MBだったのかと、手元でできる
    // 減らし方をその場で書く（上限の根拠は MAX_IMPORT_BYTES のコメント）。
    throw new ApiError(
      `ファイルサイズが上限（${MAX_LABEL}）を超えています（このファイルは約${(file.size / (1024 * 1024)).toFixed(1)}MB）。シートを分けて取り込むか、不要な列や行を削ってから、もう一度お試しください。`,
      413,
    );
  }

  const buffer = await file.arrayBuffer();
  const sheets = readAllSheets(buffer);

  if (sheets.every((s) => s.empty)) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  /*
   * ここは**ファイルを置くたび毎回**通る道で、その先が外部AIへの課金に
   * 直結している。プランと設定の両方を見てから叩く。
   * 落ちる先は決定的なヒューリスティックなので、断らずに最後まで通る。
   */
  const aiAllowed = aiAllowedFor(user.workspace.plan, user.workspace.aiEnabled);

  /*
   * 実際に外部へ飛ぶときだけ数える。ヒューリスティックで返す呼び出しまで
   * 数えると、お金が動いていないのに「21回目から取り込めない」ことになる。
   */
  if (advisorCallsOut(aiAllowed)) {
    const now = new Date();
    const limit = await consumeOptional(
      workspaceKey(user.workspace.id, "ai"),
      AI_RULE,
      now,
    );
    if (!limit.allowed) {
      throw new ApiError(
        `AIによる下見の回数が上限に達しました。${retryMessage(limit.retryAt, now)}`,
        429,
      );
    }
  }

  const { advice, via } = await adviseImport(sheets, {
    aiEnabled: aiAllowed,
  });

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
