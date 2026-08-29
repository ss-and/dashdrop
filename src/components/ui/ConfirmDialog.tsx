"use client";

/**
 * 破壊的な操作を確かめるダイアログ。
 *
 * ここに至った経緯:
 * 削除まわりの確認はぜんぶブラウザ標準の確認ダイアログに任せていた。動きはするが、
 * この製品が「ひと続きに見えること」を売りにしている以上、いちばん緊張する
 * 瞬間にだけ OS のダイアログが割り込むのは筋が悪かった。具体的に何が困るか:
 *
 *   - 見た目が製品の外側のもの（Windows / macOS の素のダイアログ）になり、
 *     そこだけ別のアプリを触っているように見える。
 *   - 素のテキスト 1 行しか出せない。だから「何が消えるか」は書けても、
 *     「何が残るか」を落ち着いて書き添えられない。旧文言が
 *     「スプレッドシートとデータは残ります」を1文に押し込んでいたのは
 *     そのためで、いちばん安心させたい情報が語尾に埋もれていた。
 *   - 日本語の折り返しを制御できない（本文の word-break: auto-phrase も効かない）。
 *   - メインスレッドを止める。閉じるまで再描画も保存中表示も動かない。
 *   - 「OK」と「キャンセル」が同じ重さに見える。取り消す方が安全な場面でも、
 *     押しやすさに差が付けられない。
 *
 * そこで確認は製品の中に持ってくる。見た目は既存のトークンのまま
 * （paper / ink / khaki、角丸 6px 以下、shadow-raised）で、
 * キーボードとフォーカスの作法は同じリポジトリの Topbar のアカウントメニューと
 * FieldEditor に合わせてある。
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";

/**
 * ダイアログ内でフォーカスを回せる要素。role="dialog" aria-modal を名乗る以上、
 * Tab が背後の画面へ抜けてしまうと「開いたのに操作先が分からない」状態になる
 * ため、この一覧を使って Tab を内側に閉じ込める。
 * （Topbar の FOCUSABLE / FieldEditor の FOCUSABLE_SELECTOR と同じ作法。）
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** root の中のフォーカス可能な要素を DOM 順（＝タブ順）で返す。 */
function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** 呼び出し側が組み立てる「問いかけ」の中身。 */
export interface ConfirmRequest {
  /** 見出し。問いの形にする（「〜しますか？」）。 */
  title: string;
  /**
   * 本文。**何が消えて、元に戻せるのか**を書く。
   * ネイティブの confirm では1行しか書けなかったので、ここは遠慮せず書いてよい。
   */
  body: ReactNode;
  /**
   * 何が残るか。`body` と別の口にしてあるのは、ここが読み飛ばされると
   * 利用者は必要以上に手を止めるからで、本文の語尾に混ぜたくないため。
   * 「スプレッドシートとデータは残ります」のたぐいは必ずこちらに書く。
   */
  keeps?: ReactNode;
  /** 確認ボタンの文言。「はい」ではなく、何が起きるかを動詞で書く。 */
  confirmLabel?: string;
  /** 取り消しボタンの文言。 */
  cancelLabel?: string;
  /**
   * 元に戻せない操作なら true。確認ボタンが危険色になり、
   * さらに**背後のクリックでは閉じなくなる**（下の onMouseDown を参照）。
   */
  destructive?: boolean;
}

export interface ConfirmDialogProps extends ConfirmRequest {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 制御されたダイアログ。開いている間だけ DOM に載る。
 *
 * 閉じているときに中身を残さないのは、フォーカスの出入り（開いたら中へ、
 * 閉じたら呼び出し元へ）をマウント／アンマウントに素直に対応させたいため。
 * 隠して残しておくと、隠れた要素に Tab が入る事故が起きる。
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  // 開くのは必ず利用者の操作のあと＝クライアント側なので、
  // サーバ描画時にここへ来ることは無い。それでも document を触る前に確かめる。
  if (typeof document === "undefined") return null;
  // ページ全体を覆う以上、呼び出し元の DOM の入れ子（overflow や transform を
  // 持つ祖先）に敷き方を左右されたくない。body 直下に出す。
  return createPortal(<ConfirmDialogPanel {...props} />, document.body);
}

function ConfirmDialogPanel({
  title,
  body,
  keeps,
  confirmLabel,
  cancelLabel = "キャンセル",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  /*
   * 開いたら中へ、閉じたら呼び出し元へ。
   *
   * 戻さないとフォーカスが body に落ち、キーボードだけの利用者は
   * 「さっき押した削除ボタンはどこだったか」を Tab で探し直すことになる。
   * 呼び出し元が消えている場合（メニューごと閉じた等）は無理に戻さない。
   *
   * 最初にどちらへ寄せるかは destructive で変える。元に戻せない操作で
   * 確認ボタンにフォーカスが乗っていると、Enter の連打がそのまま
   * 「削除」に化ける。安全な側（キャンセル）を初期位置にする。
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = destructive ? cancelRef.current : confirmRef.current;
    (first ?? panelRef.current)?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
    // destructive は開いている間に変わらない前提（同じ問いかけの中で
    // 危険度が入れ替わることは無い）。開いた瞬間の1回だけでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        // 背後のポップオーバー（共有の吹き出し、列メニュー等）も Escape を
        // 見ているので、ここで止めないと一度の Escape で2枚とも閉じる。
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === first : active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    },
    [onCancel],
  );

  return (
    <div
      /*
       * 覆いは 30% では薄かった。背後のKPIの数字（¥150,500 など）が明るいまま
       * 目に入り続け、「今はこの問いに答える場面だ」という切り替えが起きない。
       * 破壊的な確認ほど、背後を静かにしてから読ませたい。
       */
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        /*
         * 背後のクリックで閉じるのは、確認が「読んでもらうため」の
         * 足止めでしかない場合だけ。元に戻せない操作では閉じない——
         * 行き先を誤ってクリックした人が、意図せず問いかけを消してしまう
         * より、明示的に「キャンセル」を押してもらう方が安全側に倒れる。
         */
        if (destructive) return;
        onCancel();
      }}
      onKeyDown={onKeyDown}
      data-testid="confirm-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="w-full max-w-md focus:outline-none"
      >
        {/*
          動きは「出たことに気づくため」だけのもの。動きを減らす設定を
          している人には出さない（motion-safe: を付けているのはそのため）。
          止めても情報は何も失われない。
        */}
        <Card className="motion-safe:animate-fade-in shadow-raised">
          <CardHeader>
            <CardTitle id={titleId}>{title}</CardTitle>
          </CardHeader>
          <CardBody>
            <div id={bodyId}>
              <div className="text-sm leading-relaxed text-ink-soft">{body}</div>
              {keeps && (
                /*
                 * 「残るもの」は溝（paper-sunken）に落として本文と分ける。
                 * カーキで塗らないのは、ここが操作できる場所ではないため——
                 * カーキは押せるものの色として取ってある。
                 */
                <div className="mt-3 rounded-sm border border-ink-line bg-paper-sunken px-3 py-2">
                  <p className="text-xs font-semibold text-ink-muted">
                    残るもの
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
                    {keeps}
                  </p>
                </div>
              )}
            </div>
          </CardBody>
          {/*
            取り消しと肯定の重さを変える。ネイティブのダイアログでは
            どちらも同じ標準ボタンで、「やめる」方が押しにくいことすらあった。
            取り消しは ghost（枠なし）、確認は危険色か primary。
          */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-line px-5 py-4">
            <Button
              ref={cancelRef}
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
            <Button
              ref={confirmRef}
              type="button"
              variant={destructive ? "danger" : "primary"}
              size="sm"
              onClick={onConfirm}
            >
              {confirmLabel ?? (destructive ? "削除する" : "続ける")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * 呼び出し側のための入り口。
 *
 * ブラウザ標準の確認ダイアログは「聞いて、答えを返す」1行だった。置き換えでその形を
 * 失うと、削除処理が「押した時」と「確認された時」の2つに割れて読みにくく
 * なるので、同じ1行で書けるようにしてある:
 *
 *     const { ask, confirmDialog } = useConfirm();
 *     ...
 *     if (!(await ask({ title, body, keeps, destructive: true }))) return;
 *
 * 返り値の `confirmDialog` は、そのコンポーネントの JSX のどこかに一度
 * 置いておく（ポップオーバーの中ではなく、外側に置くこと。中に置くと
 * ポップオーバーが閉じた瞬間に問いかけごと消える）。
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const settleRef = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((req: ConfirmRequest) => {
    /*
     * 前の問いかけが未決のまま次が来たら、前を「取り消し」として決着させる。
     * 放置すると await している呼び出し元が永久に止まったままになり、
     * 保存中フラグが降りない・ボタンが無効のままといった形で表に出る。
     */
    settleRef.current?.(false);
    setRequest(req);
    return new Promise<boolean>((resolve) => {
      settleRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = settleRef.current;
    settleRef.current = null;
    /*
     * 閉じるのが先、答えを返すのが後。この順にしておくと、React が
     * アンマウントを流し切ってから呼び出し元の続きが動くので、
     * フォーカスは「まだ無効になっていない」呼び出し元のボタンへ戻る。
     */
    setRequest(null);
    resolve?.(ok);
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ""}
      body={request?.body ?? null}
      keeps={request?.keeps}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      destructive={request?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { ask, confirmDialog };
}
