/**
 * Generate a dashboard from a screenshot / PDF / description ("画像・PDFから作成").
 *
 * POST multipart/form-data:
 *   - description  (string, optional) — free-text of the dashboard the user wants
 *   - file         (optional)         — .png/.jpg/.jpeg/.webp/.pdf, <= 8MB
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
  type GenerateInput,
} from "@/lib/ai";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB

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
      throw new ApiError("ファイルサイズが大きすぎます（最大8MB）", 413);
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

  let template;
  let via;
  try {
    const result = await generateDashboardTemplate(input);
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
