/**
 * 製品の中の確認ダイアログ。
 *
 * ここで守りたいのは見た目ではなく、**取り返しのつかない操作の手前で
 * 起きること**。破壊的な確認の失敗はいつも同じ形で出る——聞く前に消える、
 * 閉じたつもりが消えている、キーボードだけでは閉じられない、閉じたあと
 * フォーカスがどこかへ行って表のどこにいたか分からなくなる。どれも
 * 「動いているように見える」ので、実装だけ見ても気づけない。
 *
 * 併せて、ブラウザ標準の確認ダイアログへ戻っていないことも機械的に見る
 * （最後の describe）。1か所でも戻ると、そこだけ OS のダイアログが割り込む。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";

beforeEach(() => {
  cleanup();
});

/** 破壊的な問いかけ1つぶんの既定値。テストごとに要るものだけ上書きする。 */
function show(
  overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {},
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      title="このダッシュボードを削除しますか？"
      body="グラフの並び・絞り込み・配色といった組み立てが失われ、元には戻せません。"
      keeps="元になっているスプレッドシートと、その中のデータは残ります。"
      confirmLabel="ダッシュボードを削除"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel, ...utils };
}

const overlay = () => screen.getByTestId("confirm-overlay");

describe("ConfirmDialog — 確認するまで何も起きない", () => {
  it("開いただけでは、確認のコールバックは呼ばれない", () => {
    const { onConfirm, onCancel } = show();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("確認ボタンを押したときだけ、確認のコールバックが呼ばれる", () => {
    const { onConfirm, onCancel } = show();
    fireEvent.click(screen.getByRole("button", { name: "ダッシュボードを削除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("取り消しでは確認のコールバックは呼ばれない", () => {
    const { onConfirm, onCancel } = show();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("閉じているときは何も描かない（隠れた要素に Tab が入らないように）", () => {
    show({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConfirmDialog — 何が消えて何が残るか", () => {
  it("本文と「残るもの」の両方が読める", () => {
    show();
    expect(screen.getByText(/元には戻せません/)).toBeInTheDocument();
    // ネイティブの1行では書けなかった側。ここが消えると、利用者は
    // 「データごと消えるのでは」と思って手を止める。
    expect(screen.getByText("残るもの")).toBeInTheDocument();
    expect(
      screen.getByText(/スプレッドシートと、その中のデータは残ります/),
    ).toBeInTheDocument();
  });

  it("見出しと本文がダイアログに紐付いている", () => {
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const titleId = dialog.getAttribute("aria-labelledby");
    const bodyId = dialog.getAttribute("aria-describedby");
    expect(document.getElementById(titleId!)?.textContent).toBe(
      "このダッシュボードを削除しますか？",
    );
    expect(document.getElementById(bodyId!)?.textContent).toMatch(
      /元には戻せません/,
    );
  });
});

describe("ConfirmDialog — キーボード", () => {
  it("Escape で閉じる（＝取り消し扱い）", () => {
    const { onConfirm, onCancel } = show();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("破壊的なときは、最初のフォーカスが安全側（取り消し）に乗る", () => {
    show();
    // Enter の連打がそのまま「削除」に化けないようにするための決め。
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "キャンセル" }),
    );
  });

  it("破壊的でないときは、最初のフォーカスが確認ボタンに乗る", () => {
    show({ destructive: false, confirmLabel: "続ける" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "続ける" }),
    );
  });

  it("Tab はダイアログの中で回り、背後の画面へ抜けない", () => {
    show();
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    const ok = screen.getByRole("button", { name: "ダッシュボードを削除" });

    // 最後の要素で Tab → 先頭へ戻る。
    ok.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    // 先頭で Shift+Tab → 最後へ回る。
    cancel.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(document.activeElement).toBe(ok);
  });
});

describe("ConfirmDialog — 背後のクリック", () => {
  it("破壊的な確認では、背後をクリックしても閉じない", () => {
    const { onCancel, onConfirm } = show();
    fireEvent.mouseDown(overlay());
    // 消えるより、明示的に取り消してもらう方が安全側に倒れる。
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("破壊的でない確認なら、背後のクリックで閉じる", () => {
    const { onCancel, onConfirm } = show({
      destructive: false,
      confirmLabel: "続ける",
    });
    fireEvent.mouseDown(overlay());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ダイアログ本体のクリックは背後のクリックではない", () => {
    const { onCancel } = show({ destructive: false, confirmLabel: "続ける" });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog — フォーカスの出入り", () => {
  it("閉じたら、呼び出したボタンへフォーカスが戻る", () => {
    // 戻さないとフォーカスは body に落ち、キーボードだけの利用者は
    // 「さっき押した削除ボタン」を Tab で探し直すことになる。
    render(<button type="button">削除</button>);
    const opener = screen.getByRole("button", { name: "削除" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = show();
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
  });
});

/* ------------------------------------------------------------------ *
 * 呼び出し側から見た形。1行で「聞いて、答えを受け取る」まで。
 * ------------------------------------------------------------------ */

function DeleteThing({ onDeleted }: { onDeleted: () => void }) {
  const { ask, confirmDialog } = useConfirm();
  const [gone, setGone] = useState(false);
  async function remove() {
    const ok = await ask({
      title: "この行を削除しますか？",
      body: "この1行に入っている値がすべて消えます。元には戻せません。",
      keeps: "ほかの行と、項目（列）の設定はそのまま残ります。",
      confirmLabel: "行を削除",
      destructive: true,
    });
    if (!ok) return;
    setGone(true);
    onDeleted();
  }
  return (
    <div>
      {confirmDialog}
      <button type="button" onClick={remove}>
        削除
      </button>
      {gone && <p>削除しました</p>}
    </div>
  );
}

describe("useConfirm — 呼び出し側", () => {
  it("押しただけでは削除されず、確認して初めて削除される", async () => {
    const onDeleted = vi.fn();
    render(<DeleteThing onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await screen.findByRole("dialog");
    // ここが肝。問いかけが出ている時点では、まだ何も起きていない。
    expect(onDeleted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "行を削除" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("取り消したら、削除は起きずダイアログだけ閉じる", async () => {
    const onDeleted = vi.fn();
    render(<DeleteThing onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText("削除しました")).toBeNull();
  });

  it("Escape でも、削除は起きずに閉じる", async () => {
    const onDeleted = vi.fn();
    render(<DeleteThing onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * ブラウザ標準のダイアログへ戻っていないこと。
 * ------------------------------------------------------------------ */

// jsdom 環境では import.meta.url が file: にならないので、
// vitest の実行ルート（＝リポジトリ直下）から辿る。
const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 「素のダイアログを呼んでいる」行だけを拾う。
 * `onConfirm(` のようなキャメルケースは大文字なので当たらない。ローカル関数の
 * 宣言（`function confirm(...)`）は呼び出しではないので除く。
 */
const NATIVE_CALL = /(?:^|[^.\w])(?:window\s*\.\s*)?(confirm|alert|prompt)\s*\(/;
const LOCAL_DECL = /\b(?:function|const|let|var)\s+(?:confirm|alert|prompt)\b/;

describe("src/ にブラウザ標準のダイアログが残っていない", () => {
  it("confirm / alert / prompt の呼び出しが1件も無い", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!NATIVE_CALL.test(line)) return;
          if (LOCAL_DECL.test(line)) return;
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
