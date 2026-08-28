/**
 * A related list — the Salesforce hallmark.
 *
 * One card per child collection that links AT this record: a compact table of
 * the linking rows, each one's primary cell hyperlinked to its own record page,
 * plus a すべて見る escape hatch back to the spreadsheet. Relation cells inside
 * the list are themselves links, so you can keep clicking through the graph.
 *
 * 件数の表示について。親レコードに紐づく子行は、SQLite/Prisma が JSON の中を
 * 索引できないため「新しい順に一定件数だけ読んで JS で突き合わせる」方法で
 * 数えている。つまり `total` は**見た範囲での一致数**であって総数ではない。
 * それを「全12件」と出していたころ、走査の外にある一致は数にも表示にも現れず、
 * 利用者からは打ち切りが起きたことすら分からなかった。DataGrid も検索も
 *「打ち切りは黙って行わない」で揃えてあるので、ここも走査上限に達したときは
 * 「直近200件のうち12件」と、何を見たうえでの数なのかを必ず添える。
 */
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import {
  NUMERIC_TYPES,
  RecordValue,
  recordValueText,
  type RecordFieldDef,
  type RelationLabels,
  type ResolvedRow,
} from "./RecordValue";

export interface RelatedListData {
  /** Stable key: child collection id + the relation field that links here. */
  key: string;
  collectionId: string;
  title: string;
  /** Shown when one collection links here through several relation fields. */
  subtitle?: string;
  /**
   * 一致した子行の数。**走査した範囲の中での数**であり、`scanLimited` が
   * true なら総数ではない（それ以上あるかもしれない）。
   */
  total: number;
  /** 子行の走査が上限に達したか。true なら total は総数として出せない。 */
  scanLimited: boolean;
  /** 走査した行数の上限（新しい順）。打ち切りを説明するために画面に出す。 */
  scanLimit: number;
  columns: RecordFieldDef[];
  rows: ResolvedRow[];
  relationLabels: RelationLabels;
}

/**
 * 子行の走査を上限で打ち切ったか。
 *
 * 「読めた件数が上限と同じ」なら、その先にまだ行があるかもしれない
 * （ちょうど上限ぴったりで終わっている場合も含めて、区別が付かない以上は
 * 打ち切った側に倒す。多めに断るのは害が小さいが、黙って切ると数を誤る）。
 * ページ側と表示側で判断がずれないよう、判定はここ1か所に置く。
 */
export function isScanLimited(scanned: number, scanLimit: number): boolean {
  return scanned >= scanLimit;
}

/**
 * 件数の見出し。走査を打ち切ったなら「全部で何件か」は名乗らない。
 * 検索（/api/search の `more` / `scope`）と同じで、何を見たうえでの数なのかを
 * そのまま書く。
 */
export function relatedCountLabel(list: {
  total: number;
  scanLimited: boolean;
  scanLimit: number;
}): string {
  return list.scanLimited
    ? `直近${list.scanLimit.toLocaleString()}件のうち${list.total.toLocaleString()}件`
    : `${list.total.toLocaleString()}件`;
}

export function RelatedList({ list }: { list: RelatedListData }) {
  const { columns, rows } = list;
  const primary = columns[0];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">
            {list.title}
            <span className="ml-2 text-sm font-normal text-ink-muted">
              {relatedCountLabel(list)}
            </span>
          </CardTitle>
          {list.subtitle && (
            <p className="mt-0.5 text-2xs text-ink-faint">{list.subtitle}</p>
          )}
        </div>
        <Link
          href={`/c/${list.collectionId}`}
          className="shrink-0 text-sm text-khaki-700 underline-offset-2 hover:underline"
        >
          すべて見る
        </Link>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-paper-sunken">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap border-b border-ink-line px-4 py-2 text-xs font-semibold text-ink-soft ${
                      NUMERIC_TYPES.has(c.type) ? "text-right" : "text-left"
                    }`}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-paper-sunken/50">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`border-b border-ink-line/70 px-4 py-2 align-top text-ink ${
                        NUMERIC_TYPES.has(c.type) ? "text-right" : "text-left"
                      }`}
                    >
                      {primary && c.key === primary.key ? (
                        <Link
                          href={`/r/${list.collectionId}/${row.id}`}
                          className="font-medium text-khaki-700 underline-offset-2 hover:underline"
                        >
                          {recordValueText(c, row.data) || "（無題）"}
                        </Link>
                      ) : (
                        <RecordValue
                          field={c}
                          data={row.data}
                          computed={row.computed}
                          relationLabels={list.relationLabels}
                          numericAlign={NUMERIC_TYPES.has(c.type)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
          打ち切っているなら、表示しきれていない行だけでなく「そもそも
          どこまでしか見ていないか」も出す。走査上限に達していれば、
          表示件数と一致数が同じでも黙らない（＝条件に total > rows.length を
          足さない）。「これで全部」と読ませないため。
        */}
        {(list.total > rows.length || list.scanLimited) && (
          <div className="border-t border-ink-line px-4 py-2 text-xs text-ink-muted">
            {list.scanLimited
              ? `${rows.length}件を表示中（${relatedCountLabel(list)}）。この表の新しい順 ${list.scanLimit.toLocaleString()}件 だけを対象に数えているため、これより古い行に一致があっても含まれていません。「すべて見る」で表を開いて確認できます。`
              : `${rows.length}件を表示中（全${list.total}件）`}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
