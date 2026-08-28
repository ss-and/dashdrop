/**
 * Generate a dashboard from a screenshot / PDF / description ("画像・PDFから作成").
 *
 * POST multipart/form-data:
 *   - description  (string, optional) — free-text of the dashboard the user wants
 *   - file         (optional)         — .png/.jpg/.jpeg/.webp/.pdf, <= 4MB
 * At least one of `description` / `file` is required.
 *
 * The parsed input is handed to `generateDashboardTemplate` (which degrades to a
 * heuristic template when no AI key is configured or generation fails), then the
 * resulting DashboardTemplate is materialised with `applyTemplate`. Returns the
 * new dashboard id plus which path produced it (`via`).
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { applyTemplate } from "@/lib/apply-template";
import {
  generateDashboardTemplate,
  pickHeuristicTemplate,
  aiAllowedFor,
  generationCallsOut,
  type GenerateInput,
} from "@/lib/ai";
import {
  AI_RULE,
  consumeOptional,
  retryMessage,
  workspaceKey,
} from "@/lib/rate-limit";

/**
 * 8MB → 4MB。Vercel のサーバーレス関数はリクエストボディを 4.5MB で打ち切る。
 * その判定はハンドラが起動する**前**にあるので、8MB を受け付けると宣言しても
 * 4.5〜8MB の PDF/画像はここに届かず、下の日本語メッセージは一度も出ない
 * （利用者に残るのは本文の無い 413 だけ）。自分で断れる値まで下げて、理由を
 * こちらから伝えられるようにする。詳細は src/lib/excel.ts の MAX_IMPORT_BYTES。
 *
 * 画面側（GenerateWizard）の定数・文面も同じ 4MB に揃えてある。定数だけ下げて
 * 文面を残すと「4MB で断りながら 8MB と言う」状態になり、断られた人には
 * 何が起きたのか分からない。上限を動かすときは必ず両方を一緒に動かすこと。
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function fileKindFor(name: string, type: string): {
  kind: "image" | "pdf";
  mediaType: string;
} | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf" || type === "application/pdf") {
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  if (ext in IMAGE_TYPES) {
    return { kind: "image", mediaType: IMAGE_TYPES[ext] };
  }
  // Trust an explicit image/* content type as a fallback.
  if (type.startsWith("image/") && Object.values(IMAGE_TYPES).includes(type)) {
    return { kind: "image", mediaType: type };
  }
  return null;
}

export const POST = withAuth(async (req, { user }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("フォームデータの解析に失敗しました", 400);
  }

  const description = (form.get("description") as string | null)?.trim() || "";
  const file = form.get("file");

  const input: GenerateInput = {};
  if (description) input.description = description;

  if (file && file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(
        `ファイルサイズが大きすぎます（${(file.size / 1024 / 1024).toFixed(1)}MB / 上限 4MB）。` +
          `画像なら書き出しの品質を下げるか、PDF ならページを絞ってからお試しください。`,
        413,
      );
    }
    const meta = fileKindFor(file.name, file.type);
    if (!meta) {
      throw new ApiError(
        "対応していないファイル形式です（.png / .jpg / .jpeg / .webp / .pdf）",
        400,
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    input.file = {
      base64: buffer.toString("base64"),
      mediaType: meta.mediaType,
      kind: meta.kind,
    };
  }

  if (!input.description && !input.file) {
    throw new ApiError(
      "画像・PDFのアップロード、または作りたいダッシュボードの説明を入力してください",
      400,
    );
  }

  /*
   * 画像・PDFがまるごと外部へ渡り、1回ごとに実費が出る経路。プランと
   * ワークスペースの設定の両方を見てから叩く。閉じていても断らない——
   * ヒューリスティックが「入力に最も近いテンプレート」を必ず返すので、
   * Free でもダッシュボードは作れる。
   */
  const aiAllowed = aiAllowedFor(user.workspace.plan, user.workspace.aiEnabled);

  // 数えるのは外部へ飛ぶときだけ。ヒューリスティックで返す呼び出しまで
  // 数えると、お金が動いていないのにダッシュボードが作れなくなる。
  if (generationCallsOut(aiAllowed)) {
    const now = new Date();
    const limit = await consumeOptional(
      workspaceKey(user.workspace.id, "ai"),
      AI_RULE,
      now,
    );
    if (!limit.allowed) {
      throw new ApiError(
        `AIによる生成の回数が上限に達しました。${retryMessage(limit.retryAt, now)}`,
        429,
      );
    }
  }

  let template;
  let via;
  try {
    const result = await generateDashboardTemplate(input, {
      aiEnabled: aiAllowed,
    });
    template = result.template;
    via = result.via;
  } catch (err) {
    // generateDashboardTemplate already falls back to a heuristic internally, so
    // reaching here is unusual. Retry once via the heuristic before giving up.
    try {
      template = pickHeuristicTemplate(input);
      via = "heuristic" as const;
    } catch {
      console.error("Dashboard generation failed:", err);
      throw new ApiError(
        "ダッシュボードの生成に失敗しました。説明を具体的にして再度お試しください。",
        502,
      );
    }
  }

  const { dashboardId } = await applyTemplate(user, template, {
    withSampleData: true,
    source: "ai",
  });

  return ok({ dashboardId, via });
});
