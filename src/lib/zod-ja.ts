/**
 * Zod の既定メッセージを日本語にする。
 *
 * 全画面が日本語なのに、入力エラーだけ
 * 「name: String must contain at least 1 character(s)」のような英語が
 * そのまま利用者に出ていた。個々のスキーマに message を書いて回るより、
 * エラーマップを1回差し替えるほうが漏れがない。
 *
 * 個別に message を指定してあるスキーマはそちらが優先されるので、
 * すでに書かれている日本語の文言はそのまま残る。
 */
import { z, type ZodErrorMap } from "zod";

/** 「文字」「件」「以下」など、型ごとに自然な単位に振り分ける。 */
function unitOf(type: string): string {
  switch (type) {
    case "string":
      return "文字";
    case "array":
    case "set":
      return "件";
    default:
      return "";
  }
}

const TYPE_LABEL: Record<string, string> = {
  string: "文字列",
  number: "数値",
  boolean: "true / false",
  date: "日付",
  array: "配列",
  object: "オブジェクト",
  integer: "整数",
  bigint: "整数",
  null: "null",
  undefined: "未指定",
};

const errorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: "入力してください" };
      }
      return {
        message: `${TYPE_LABEL[String(issue.expected)] ?? issue.expected}で入力してください`,
      };

    case z.ZodIssueCode.too_small: {
      const unit = unitOf(issue.type);
      if (issue.type === "string" && issue.minimum === 1) {
        return { message: "入力してください" };
      }
      const bound = `${issue.minimum}${unit}`;
      return {
        message: issue.inclusive
          ? `${bound}以上で入力してください`
          : `${bound}より大きい値を入力してください`,
      };
    }

    case z.ZodIssueCode.too_big: {
      const unit = unitOf(issue.type);
      const bound = `${issue.maximum}${unit}`;
      return {
        message: issue.inclusive
          ? `${bound}以内で入力してください`
          : `${bound}より小さい値を入力してください`,
      };
    }

    case z.ZodIssueCode.invalid_enum_value:
      return { message: "選択できない値です" };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: "扱えない項目が含まれています" };

    case z.ZodIssueCode.invalid_string: {
      const v = issue.validation;
      if (v === "email") return { message: "メールアドレスの形式で入力してください" };
      if (v === "url") return { message: "URLの形式で入力してください" };
      if (v === "uuid") return { message: "IDの形式が正しくありません" };
      return { message: "形式が正しくありません" };
    }

    case z.ZodIssueCode.not_finite:
      return { message: "数値を入力してください" };

    case z.ZodIssueCode.custom:
      // custom は呼び出し側が日本語を書いている前提。既定文言のときだけ補う。
      return { message: ctx.defaultError === "Invalid input" ? "入力内容が正しくありません" : ctx.defaultError };

    default:
      return { message: "入力内容が正しくありません" };
  }
};

let installed = false;

/** アプリ起動時に1回だけ呼ぶ。多重呼び出しは無害。 */
export function installJapaneseZodMessages(): void {
  if (installed) return;
  z.setErrorMap(errorMap);
  installed = true;
}

/**
 * API のスキーマ項目名 → 画面で使っている日本語。
 *
 * エラー文の頭に内部の英語キー（`name:`）が出ると、日本語の文面の中で
 * そこだけ英語になって「何のことか分からない」ままになる。ここに無いキーは
 * 見出しを付けずに理由だけを返す（誤訳より無い方がまし）。
 */
const FIELD_LABEL: Record<string, string> = {
  name: "名前",
  collectionName: "スプレッドシート名",
  workspaceName: "ワークスペース名",
  description: "説明",
  email: "メールアドレス",
  password: "パスワード",
  url: "URL",
  webhookUrl: "Webhook URL",
  channelHint: "通知先チャンネル",
  token: "トークン",
  databaseId: "データベース",
  collectionId: "スプレッドシート",
  dashboardId: "ダッシュボード",
  templateKey: "テンプレート",
  template: "テンプレート",
  collectionSlugs: "スプレッドシート",
  key: "項目キー",
  label: "表示名",
  type: "種類",
  options: "選択肢",
  required: "必須",
  position: "並び順",
  fields: "項目",
  records: "レコード",
  config: "設定",
  icon: "アイコン",
  color: "色",
  layout: "レイアウト",
  metric: "指標",
  measure: "集計方法",
  filters: "絞り込み",
  operator: "条件",
  threshold: "しきい値",
  channel: "通知先",
  frequency: "頻度",
  enabled: "有効",
  value: "値",
  withSampleData: "サンプルデータ",
  sheets: "シート",
};

/**
 * Zod の issue path を、利用者に見せる見出しにする。
 * 訳が無いキーは見出しごと省く（英語のキーを見せない）。
 */
export function fieldLabelForPath(path: Array<string | number>): string | null {
  const parts = path.filter(
    (p): p is string => typeof p === "string" && p !== "data",
  );
  const last = parts[parts.length - 1];
  if (!last) return null;
  return FIELD_LABEL[last] ?? null;
}
