import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

/**
 * デザイントークンのコントラスト回帰テスト。
 *
 * 色は tailwind.config.ts の1か所で決まり、そこから製品全体に配られる。つまり
 * 「あとで誰かが少し明るくした」だけで、サイドバーの件数も入力欄のプレース
 * ホルダーもフォーカスリングも一斉に WCAG を割る。そこでハードコードした期待値
 * ではなく、トークンの実値から WCAG の相対輝度式で比を計算し、しきい値を
 * 満たしているかを検証する。
 *
 * しきい値（WCAG 2.2 AA）
 *   - 本文テキスト（24px 未満 / 太字 19px 未満）: 4.5:1
 *   - 非テキスト（フォーカスリング、UI 部品の境界）: 3:1
 */

/** WCAG 2.x の相対輝度。 */
function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG 2.x のコントラスト比。順序は問わない。 */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

type ColorScale = Record<string, string>;

/** tailwind.config.ts の theme.extend.colors から実際のトークン値を取り出す。 */
const palette = config.theme?.extend?.colors as
  | Record<string, ColorScale | string>
  | undefined;

function scale(name: string): ColorScale {
  const entry = palette?.[name];
  if (!entry || typeof entry === "string") {
    throw new Error(`色スケール ${name} が tailwind.config.ts に見つかりません`);
  }
  return entry;
}

const paper = scale("paper");
const khaki = scale("khaki");
const ink = scale("ink");

/** 文字が載りうる明るい面。いちばん条件が厳しいのは sunken（溝）。 */
const SURFACES: Record<string, string> = {
  paper: paper.DEFAULT,
  "paper-raised": paper.raised,
  "paper-sunken": paper.sunken,
  "khaki-50": khaki["50"],
};

/** 面のうち最も比が低くなるものの値を返す。 */
function worstOnSurfaces(fg: string): number {
  return Math.min(...Object.values(SURFACES).map((bg) => contrastRatio(fg, bg)));
}

describe("トークンの値が16進6桁であること", () => {
  it.each([
    ...Object.entries(SURFACES),
    ["ink", ink.DEFAULT],
    ["ink-soft", ink.soft],
    ["ink-muted", ink.muted],
    ["ink-faint", ink.faint],
    ["khaki-500", khaki["500"]],
  ])("%s = %s", (_name, value) => {
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("本文テキストのトークンは全ての明るい面で AA(4.5:1) を満たす", () => {
  /*
   * ink-faint は件数・タイムスタンプ・プレースホルダーなど実データを 12–13px で
   * 載せる役なので、大きな文字の例外（3:1）は使えない。4段すべてを本文基準で見る。
   */
  const textTokens: Record<string, string> = {
    ink: ink.DEFAULT,
    "ink-soft": ink.soft,
    "ink-muted": ink.muted,
    "ink-faint": ink.faint,
  };

  for (const [token, value] of Object.entries(textTokens)) {
    for (const [surface, bg] of Object.entries(SURFACES)) {
      it(`${token} on ${surface}`, () => {
        expect(contrastRatio(value, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("インクの階調は「静かさ」の順序を保つ", () => {
  /*
   * AA を通すために暗くしただけで序列が崩れると、情報の優先度が読めなくなる。
   * faint が最も静か（＝比が低い）で、ink に向かって強くなること。
   */
  it("faint < muted < soft < ink （paper 上のコントラスト比）", () => {
    const on = (fg: string) => contrastRatio(fg, paper.DEFAULT);
    expect(on(ink.faint)).toBeLessThan(on(ink.muted));
    expect(on(ink.muted)).toBeLessThan(on(ink.soft));
    expect(on(ink.soft)).toBeLessThan(on(ink.DEFAULT));
  });

  it("階調差はどの段も 1.15 倍以上あり、見分けがつく", () => {
    const on = (fg: string) => contrastRatio(fg, paper.DEFAULT);
    expect(on(ink.muted) / on(ink.faint)).toBeGreaterThanOrEqual(1.15);
    expect(on(ink.soft) / on(ink.muted)).toBeGreaterThanOrEqual(1.15);
    expect(on(ink.DEFAULT) / on(ink.soft)).toBeGreaterThanOrEqual(1.15);
  });

  it("暖色（R>G>B）のカーキ寄りグレーという性格を保つ", () => {
    for (const value of [ink.faint, ink.muted, ink.soft, ink.DEFAULT]) {
      const [r, g, b] = [1, 3, 5].map((i) =>
        parseInt(value.slice(i, i + 2), 16),
      );
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
  });
});

describe("フォーカスインジケーターは 1.4.11 の 3:1 を満たす", () => {
  it("khaki-500（リング色）はどの面の上でも 3:1 以上", () => {
    expect(worstOnSurfaces(khaki["500"])).toBeGreaterThanOrEqual(3);
  });

  it("khaki-500 は ring-offset に使う paper とも 3:1 以上", () => {
    expect(contrastRatio(khaki["500"], paper.DEFAULT)).toBeGreaterThanOrEqual(3);
  });

  it("box-shadow のフォーカストークンは不透明（半透明だと薄まって落ちる）", () => {
    const shadows = config.theme?.extend?.boxShadow as
      | Record<string, string>
      | undefined;
    const focus = shadows?.focus ?? "";
    expect(focus).toContain("rgba(111, 104, 63, 1)");
  });
});

describe("globals.css のフォーカス指定が半透明に戻っていないこと", () => {
  // vitest はプロジェクトルートで動くので、そこからの相対パスで読む。
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

  /*
   * `ring-khaki-500/50` のような不透明度つきユーティリティは、計算上の色が
   * 背景と混ざった結果になるため、トークンの値だけを見ていても検出できない。
   * ここだけはソースを直接読んで、混色されたリングが復活していないかを見る。
   */
  it(":focus-visible と .input-base のリングがベタ塗り", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*ring-khaki-500(?![/\d])/);
    expect(css).not.toMatch(/ring-khaki-500\/\d+/);
  });

  it("プレースホルダーは AA を満たす ink-faint を使う", () => {
    expect(css).toContain("placeholder:text-ink-faint");
    expect(worstOnSurfaces(ink.faint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("khaki-500 の面に白文字を載せる用途（プライマリボタン・アバター）", () => {
  it("白文字が AA を満たす", () => {
    expect(contrastRatio("#ffffff", khaki["500"])).toBeGreaterThanOrEqual(4.5);
  });
});
