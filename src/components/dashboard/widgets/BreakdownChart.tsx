"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  Treemap,
  FunnelChart,
  Funnel,
} from "recharts";
import { formatCompact } from "@/lib/utils";
import { drillHref, EMPTY_BUCKET, type DrillFilter } from "@/lib/drill";
import { useDrillOrigin } from "../DrillOriginContext";
import type { BreakdownData } from "@/lib/widgets";

/**
 * Categorical breakdown widget: donut / horizontal bars / treemap / funnel.
 * どれも同じ集計結果（BreakdownData）を、違う読み方で見せる。
 * Earthy palette mapped from slice color tokens, with a graceful "データなし"
 * state when every value is zero.
 */

import {
  seriesColor,
  CHART_GRID as GRID,
  CHART_TEXT as TEXT,
} from "@/lib/palette";
import { usePalette } from "../PaletteContext";

/** ツリーマップの区画が色を受け取れなかったときの受け皿。 */
const NO_COLOR = "#a8a493";

/**
 * ツリーマップの1区画。
 *
 * Recharts は既定だと区画に何も書かないので、色の四角が並ぶだけになる。
 * 名前と数字を入れるが、入り切らない小さな区画に押し込むと文字が枠から
 * はみ出して隣と重なるため、幅と高さが足りるときだけ描く。
 */
function TreemapCell(props: unknown) {
  const p = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    depth?: number;
    name?: string;
    value?: number;
    fill?: string;
  };
  const { x = 0, y = 0, width = 0, height = 0, depth, name = "", value, fill } = p;
  // 深さ0は全体を覆う根。ここを塗ると全部同じ色で埋まる。
  if (depth === 0 || width <= 0 || height <= 0) return null;

  const showLabel = width > 72 && height > 34;
  // 日本語は全角なので、およそ 12px/字 で収まる字数に切る。
  const maxChars = Math.max(1, Math.floor((width - 16) / 12));
  const label = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill ?? NO_COLOR}
        stroke="#fbfaf6"
        strokeWidth={2}
      />
      {showLabel && (
        <>
          <text x={x + 8} y={y + 20} fill="#ffffff" fontSize={12}>
            {label}
          </text>
          {typeof value === "number" && (
            <text
              x={x + 8}
              y={y + 36}
              fill="rgba(255,255,255,0.85)"
              fontSize={12}
            >
              {formatCompact(value)}
            </text>
          )}
        </>
      )}
    </g>
  );
}

/** ファネルの段名＋数字を置く右余白。ここを削ると文字がカードから出る。 */
const FUNNEL_LABEL_WIDTH = 132;

const tooltipStyle = {
  borderRadius: 6,
  border: "1px solid #e2ded1",
  background: "#fbfaf6",
  fontSize: 12,
  color: TEXT,
} as const;

export function BreakdownChart({ data }: { data: BreakdownData }) {
  const palette = usePalette();
  const { type, slices, total, groupBy, groupByMulti, collectionId } = data;
  const origin = useDrillOrigin();
  const empty = slices.length === 0 || total === 0;
  const router = useRouter();

  /*
   * ひと切れ押したら、その内訳の行を開く。
   *
   * 「フェーズB が 3,600万」で終わってしまうと、どの案件なのかに辿り着けない。
   * 残余（その他）は複数の値をまとめた合成なので、絞り込み先が定まらず押せない
   * ——集計側は畳んだキーの一覧を残していないので、押せてしまうと必ず 0 件になる。
   *
   * URLは自分で組まず drillHref に任せる。以前は各ウィジェットが手で組んでいて
   * `?f=&v=` と `?f_列=` の2種類に割れ、後者は受け側が読まないまま**絞り込まれて
   * いない全件の表**を開いていた（型が無いので誰も気づけなかった）。
   */
  const canDrill = Boolean(groupBy && collectionId);
  const filterFor = (slice: {
    key?: string;
    label?: string;
    synthetic?: boolean;
  }): DrillFilter | null => {
    if (!canDrill || slice.synthetic || slice.key === undefined) return null;
    // 空・null・"" は集計側が1つのグループに畳んでいる。eq で「—」を送ると、
    // 実データに「—」という文字が入っている行しか出ない。
    if (slice.key === EMPTY_BUCKET) return { op: "empty", field: groupBy! };
    /*
     * has を使うのは、この列が複数選択かどうかが**ここでは分からない**ため。
     * 集計側は配列を要素ごとに全バケットへ展開するので、複数選択の列に eq を
     * 当てると必ず 0 件になる。単一値では has と eq は同じ行に当たる（drill.ts の
     * matchesFilter を参照）ので、判別できない側に倒すなら has が安全。
     * ウィジェットへ列の型（fields[].type）が渡るようになったら、単一値の列は
     * eq に落として「= 営業部」と表示したい。
     */
    return {
      op: groupByMulti ? "has" : "eq",
      field: groupBy!,
      value: slice.key,
      // 選択肢型は保存値（"parttime"）ではなく表示名（"パート・アルバイト"）を出す。
      ...(slice.label && slice.label !== slice.key ? { label: slice.label } : {}),
    };
  };
  const hrefFor = (slice: {
    key?: string;
    label?: string;
    synthetic?: boolean;
  }): string | null => {
    const f = filterFor(slice);
    return f ? drillHref(collectionId!, [f], { from: origin ?? undefined }) : null;
  };
  const drillTo = (slice: { key?: string; label?: string; synthetic?: boolean }) => {
    const href = hrefFor(slice);
    if (href) router.push(href);
  };

  if (empty) {
    return (
      <div className="flex h-56 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  /*
   * ツリーマップ。面積で構成比を見る。
   *
   * 項目が10個を超えるとドーナツは細い扇が並ぶだけで読めなくなる。面積なら
   * 数が増えても「どれが大きいか」は保たれるので、多項目の構成比はこちら。
   */
  if (type === "treemap") {
    const rows = slices.map((s, i) => ({
      name: s.label,
      size: Math.abs(s.value),
      value: s.value,
      key: s.key,
      // ラベルは表示だけでなく絞り込みチップの文字にも使う（選択肢の表示名）。
      label: s.label,
      synthetic: s.synthetic,
      fill: seriesColor(palette, i, s.color),
    }));
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={rows}
            dataKey="size"
            stroke="#fbfaf6"
            isAnimationActive={false}
            content={<TreemapCell />}
            onClick={(node: unknown) => {
              const n = node as
                | { key?: string; label?: string; synthetic?: boolean }
                | undefined;
              if (n) drillTo(n);
            }}
          />
        </ResponsiveContainer>
      </div>
    );
  }

  /*
   * ファネル。段階ごとの厚みを上から順に見る。
   *
   * 並びは値の大小ではなく段階の順（集計側で order: "label"）。「A: 契約完了」
   * より「D: 初回ヒアリング」の方が件数が多いのは普通のことで、それを大きい順に
   * 並べ替えてしまうと、どこで落ちているのかが読めなくなる。
   */
  if (type === "funnel") {
    const rows = slices.map((s, i) => ({
      ...s,
      fill: seriesColor(palette, i, s.color),
      // ラベルと数字を1本にまとめる。長い名前は右の余白に収まらないので省略する。
      caption: `${s.label.length > 9 ? `${s.label.slice(0, 8)}…` : s.label}　${formatCompact(s.value)}`,
    }));
    return (
      <div className="w-full" style={{ height: Math.max(220, rows.length * 46) }}>
        <ResponsiveContainer width="100%" height="100%">
          {/*
            右の余白は必ず確保する。8px しか空けなかったときは、段の名前が
            カードの外に出て「見積提出」「失注 1…」のように切れて読めなかった。
            漏斗そのものより、どの段が何件かの方が大事。
          */}
          <FunnelChart margin={{ top: 8, right: FUNNEL_LABEL_WIDTH, bottom: 8, left: 8 }}>
            <Tooltip contentStyle={tooltipStyle} />
            <Funnel
              dataKey="value"
              nameKey="label"
              data={rows}
              isAnimationActive={false}
              // Funnel の onClick は (データ, 添字, イベント) で呼ばれる。
              // 引数を2つ書くと MouseEventHandler と型が合わないので、
              // データだけを受ける。
              onClick={(entry: unknown) =>
                drillTo(entry as { key?: string; synthetic?: boolean })
              }
              cursor={canDrill ? "pointer" : undefined}
            >
              {rows.map((r) => (
                <Cell
                  key={r.label}
                  fill={r.fill}
                  /* 残余（その他）は押せないので、指の形も変えない。 */
                  cursor={hrefFor(r) ? "pointer" : "default"}
                />
              ))}
              <LabelList
                dataKey="caption"
                position="right"
                style={{ fill: TEXT, fontSize: 12 }}
              />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "hbar") {
    const rows = slices.map((s, i) => ({
      ...s,
      fill: seriesColor(palette, i, s.color),
    }));
    // Give each bar breathing room; grow the container with the row count.
    const height = Math.max(200, rows.length * 40 + 24);
    return (
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            /* 右は棒の先の数字ぶん。24px だと「27.4万」が「27.4」で切れる。 */
            margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              /*
               * 日本語の会社名は 96px では頭が切れて「ィンテック・ラボ」のように
               * 読めなくなる。幅を広げ、それでも溢れる分だけ末尾を省略する。
               */
              width={150}
              tickFormatter={(v: string) =>
                v.length > 11 ? `${v.slice(0, 10)}…` : v
              }
            />
            <Tooltip cursor={{ fill: "rgba(138,130,80,0.06)" }} contentStyle={tooltipStyle} />
            <Bar
              dataKey="value"
              radius={[0, 2, 2, 0]}
              maxBarSize={26}
              isAnimationActive={false}
              onClick={(_: unknown, index: number) => drillTo(rows[index])}
              cursor={canDrill ? "pointer" : undefined}
            >
              {rows.map((r) => (
                <Cell
                  key={r.label}
                  fill={r.fill}
                  /* 残余（その他）は押せないので、指の形も変えない。 */
                  cursor={hrefFor(r) ? "pointer" : "default"}
                />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                style={{ fill: TEXT, fontSize: 11 }}
                formatter={(v: number) => formatCompact(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Donut
  const rows = slices.map((s, i) => ({ ...s, fill: seriesColor(palette, i, s.color) }));
  const chart = (
    <div className="relative h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="60%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            onClick={(_: unknown, index: number) => drillTo(rows[index])}
            cursor={canDrill ? "pointer" : undefined}
          >
            {rows.map((r) => (
              <Cell
                  key={r.label}
                  fill={r.fill}
                  /* 残余（その他）は押せないので、指の形も変えない。 */
                  cursor={hrefFor(r) ? "pointer" : "default"}
                />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center total */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {formatCompact(total)}
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted">合計</span>
      </div>
    </div>
  );

  /*
   * 凡例。色だけ塗られた円は「どの色がどのフェーズか」が分からず読めない。
   * ここを本物のリンクにすることで、読めるようにするのと、明細へ辿れるように
   * するのを同時に片付ける（円弧そのもののクリックは、ドーナツの穴の上では
   * 当たらないので、これが確実な導線になる）。
   */
  const legend = (
    <ul className="mt-2 space-y-0.5">
      {rows.map((r) => {
        const label = (
          <>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: r.fill }}
            />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {formatCompact(r.value)}
            </span>
          </>
        );
        const cls =
          "flex items-center gap-2 rounded px-2 py-1 text-sm text-ink-soft";
        const href = hrefFor(r);
        return (
          <li key={r.label}>
            {href ? (
              <Link
                href={href}
                className={`${cls} transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line`}
              >
                {label}
              </Link>
            ) : (
              <span className={cls}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {chart}
      {legend}
    </div>
  );
}
