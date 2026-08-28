/**
 * 画面側のアップロード上限の回帰テスト（ImportWizard / ExcelDropZone）。
 *
 * 【なぜサーバ側のテストだけでは足りないのか】
 * Vercel はリクエストボディを 4.5MB で打ち切る。その 413 はハンドラが起動する
 * **前**に返るので、大きいファイルではサーバ側の日本語メッセージは production で
 * 一度も出ない。つまりこの2つの画面の判定は「二重チェック」ではなく、
 * **利用者に理由が届く唯一の場所**になる。
 *
 * 固定したい契約:
 *   1. 上限を超えるファイルは、そもそもサーバへ送らない（fetch が飛ばない）
 *   2. 「大きすぎます」だけで終わらせず、何MBで／上限がいくつで／次に何をすれば
 *      いいのかを日本語で見せる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ImportWizard } from "@/components/import/ImportWizard";
import { ExcelDropZone } from "@/components/home/ExcelDropZone";
import { MAX_IMPORT_BYTES } from "@/lib/excel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * 指定のサイズを名乗るファイル。実バイト列は作らない（4MB を毎回確保する
 * 意味は無いし、判定が見ているのは `size` だけ）。
 */
function fileOfSize(name: string, bytes: number): File {
  const file = new File(["x"], name, { type: "text/csv" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

function pickFile(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
}

/**
 * 下見（preview / analyze）の最小の成功ペイロード。
 *
 * 中身は空でよいが、**形は本物と同じにする**。`advice` を欠くと確認画面が
 * 描画中に落ち、「送られたかどうか」を見に来ただけのテストが、無関係な例外で
 * 赤くなる（あるいは unhandled error として素通りする）。
 */
const EMPTY_PREVIEW = {
  fileName: "ぎりぎり.csv",
  fileBase: "ぎりぎり",
  sheets: [],
  advice: { sheets: [], columns: {}, questions: [] },
  via: "heuristic",
  existing: null,
};

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: EMPTY_PREVIEW }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

const OVERSIZE = MAX_IMPORT_BYTES + 1;

describe("画面側のアップロード上限", () => {
  it("ImportWizard: 上限超えのファイルは送らず、理由と次の一手を出す", async () => {
    const { container } = render(createElement(ImportWizard));

    pickFile(container, fileOfSize("巨大な売上台帳.xlsx", 12 * 1024 * 1024));

    const alert = await screen.findByText(/大きすぎます/);
    // 何が起きたか — このファイルの大きさと、上限。
    expect(alert.textContent).toContain("12.0MB");
    expect(alert.textContent).toContain("4MB");
    // どうすれば直るか。
    expect(alert.textContent).toMatch(/シートを分け|列や行を削/);
    // 送っていないこと。送ってしまうと、この文面ではなく本文の無い 413 になる。
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ImportWizard: 上限ちょうどのファイルは送る", async () => {
    // 境界の向き。`>=` に書き換えると、ちょうど 4MB のファイルが理由もなく
    // 弾かれるようになる。
    const { container } = render(createElement(ImportWizard));

    pickFile(container, fileOfSize("ぎりぎり.xlsx", MAX_IMPORT_BYTES));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/import/preview");
    expect(screen.queryByText(/大きすぎます/)).toBeNull();
  });

  it("ExcelDropZone: 上限超えのファイルは送らず、理由と次の一手を出す", async () => {
    const { container } = render(createElement(ExcelDropZone));

    pickFile(container, fileOfSize("巨大な売上台帳.xlsx", OVERSIZE));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("大きすぎます");
    expect(alert.textContent).toContain("4MB");
    expect(alert.textContent).toMatch(/シートを分け|列や行を削/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ExcelDropZone: 上限ちょうどのファイルは送る", async () => {
    const { container } = render(createElement(ExcelDropZone));

    pickFile(container, fileOfSize("ぎりぎり.csv", MAX_IMPORT_BYTES));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/import/analyze");
  });
});
