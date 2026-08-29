/**
 * 初回ログインの「設定ガイド」——何が済んで、次に何をすればいいのか。
 *
 * ## なぜウィザードにしなかったのか
 *
 * この製品の約束は「Excelを置いたらダッシュボードが出る」で、登録直後に
 * 5問答えさせるのは**その約束を最初に破ること**になる。だから入口は塞がない。
 * 代わりに Stripe の「設定ガイド」と同じ形——右下に常駐して進捗と「次: ◯◯」を
 * 出し続け、畳めて、閉じられて、**全部済んだら消える**——だけを借りた。
 * 借りたのは骨格だけで、見た目はこのリポジトリの紙とカーキのまま。
 *
 * ## ここに並べてよいもの
 *
 * **実装済みの機能だけ**。「まだ無いもの」を課題として出すと、押した先で
 * 行き止まりに当たる。それは初日の利用者にいちばんやってはいけないことで、
 * このリポジトリが plans.ts で features / planned を分けているのと同じ理由。
 *
 * ## 判定はここ（純粋関数）だけ
 *
 * 件数を数えるのはサーバー、出すのは画面、**決めるのはここ**。3か所に判定が
 * 散ると「パネルは消えたのにチェックが付いていない」のような食い違いが出る。
 * 純粋関数なのでテストで固定できる（tests/onboarding.test.ts）。
 */

/** ステップの識別子。localStorage やテストから名指しできるよう型で固定する。 */
export type OnboardingStepId =
  | "import"
  | "records"
  | "dashboard"
  | "verifyEmail"
  | "share";

export interface OnboardingStep {
  id: OnboardingStepId;
  /** 一覧に出す短い動詞句。 */
  label: string;
  /**
   * **なぜやるのか**を1行で。
   *
   * 「取り込む」だけ書かれた課題は作業指示でしかなく、飛ばす理由にしかならない。
   * 得られるものを書いておくと、押すかどうかを利用者が自分で決められる。
   */
  description: string;
  /** 押したときの行き先。必ず今あるページを指すこと。 */
  href: string;
  done: boolean;
}

/**
 * 判定のもとになるワークスペースの状態。
 *
 * 数値はどれも **0 か 0 より大きいか**しか見ていない。呼ぶ側が正確な件数を
 * 数える必要はなく、「1件でもあるか」を安く調べて 0/1 を渡してもよい
 * （実際 src/app/(app)/layout.tsx はレコードだけそうしている。全レコードの
 * COUNT を全ページで走らせる価値は、この用途には無い）。
 */
export interface OnboardingState {
  workbooks: number;
  dashboards: number;
  records: number;
  sharedDashboards: number;
  emailVerified: boolean;
}

/**
 * 状態からステップ一覧を作る。
 *
 * 順番は利用者がたどる順そのもの。特にメール確認は共有リンクより**前**に
 * 置いてある——確認が済むまで公開リンクは作れない仕様（VerifyEmailBanner に
 * 書いてあるとおり）なので、逆順に並べると最後の課題が押せないまま残る。
 */
export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  return [
    {
      id: "import",
      label: "Excelを取り込む",
      description:
        "手元のファイルを置くだけで、列がそのまま項目になった表ができます。",
      href: "/import",
      done: s.workbooks > 0,
    },
    {
      id: "records",
      label: "表の中身を見る",
      description:
        "取り込んだ行はそのまま編集できます。Excelを開き直す必要はありません。",
      href: "/home",
      done: s.records > 0,
    },
    {
      id: "dashboard",
      label: "ダッシュボードを作る",
      description:
        "毎回集計し直さなくても、開くたびに今の数字が出ます。",
      href: "/dashboards",
      done: s.dashboards > 0,
    },
    {
      id: "verifyEmail",
      label: "メールアドレスを確認する",
      /*
       * 「通知メールの宛先もここで確定します」と書いていたが、**この製品に
       * メールで通知する経路は無い**。通知は画面の中と Slack だけで、
       * alerts の channel も inapp|slack のまま（src/lib/alerts.ts に
       * 「email を足さないこと」と明記してある）。
       * 確認メール自体は届くので、それらしく読めてしまうのが厄介だった。
       */
      description: "確認が済むと、ダッシュボードの公開リンクを作れます。",
      href: "/settings",
      done: s.emailVerified,
    },
    {
      id: "share",
      label: "共有リンクを作る",
      description:
        "アカウントの無い相手にも、読み取り専用のURLひとつで見せられます。",
      href: "/dashboards",
      done: s.sharedDashboards > 0,
    },
  ];
}

/**
 * 進捗の数え方。
 *
 * `complete` が true になったら画面はパネルを出さない。**永久に居座るパネルは
 * 邪魔なだけ**で、消えないガイドは「閉じる」を探させるための装置になる。
 *
 * 課題が1つも無いとき（total === 0）も complete。出すものが無いなら
 * 出さない、が正しい振る舞いで、空の枠を残す理由がない。
 */
export function onboardingProgress(steps: OnboardingStep[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const done = steps.filter((step) => step.done).length;
  const total = steps.length;
  return { done, total, complete: done === total };
}

/**
 * 次にやること＝**最初の**未完了。
 *
 * 「残っているもののうち一番簡単なもの」ではなく、必ず先頭から。順番には
 * 依存関係が入っている（取り込む前にダッシュボードは作れない、メール確認の
 * 前に公開リンクは作れない）ので、並べ替えると押せない課題を勧めてしまう。
 */
export function nextStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((step) => !step.done) ?? null;
}

/* ========================================================================== *
 * 済んだ人には数えない
 * ========================================================================== */

/**
 * 設定ガイドを終えたことを覚えておく Cookie の名前。
 *
 * この材料を集めるクエリは `(app)/layout.tsx`——**全ページ共通の器**——に
 * 乗っている。安いクエリではあるが、乗る場所が悪い: 去年オンボーディングを
 * 終えた利用者も、以後ずっと毎ページ4本を払い続けることになる。パネルは
 * もう出ないのに。
 *
 * 有料1,000人の規模だと、これだけで月に数十万クエリが「出ないパネルのため」
 * に走る。運用コストの内訳では、1ページあたりのクエリ数がいちばん効く費目
 * だった（通知ベルの30秒ポーリングを直したのと同じ理由）。
 *
 * だから終わったことを Cookie に置き、次からは数えずに済ませる。DBに列を
 * 足さないのは、この情報が失われても困らないから——Cookie が無ければ数え
 * 直すだけで、答えは同じになる。
 */
export const SETUP_DONE_COOKIE = "dashdrop_setup_done";

/**
 * 覚えておく期間（秒）。90日。
 *
 * 永久にしないのは、完了が**戻りうる**から。取り込んだファイルを全部消せば
 * 「Excelを取り込む」は未完了に戻る。そのとき Cookie が永久だと、二度と
 * ガイドが出ない。90日で自然に数え直すようにして、静かに壊れたままに
 * ならないようにする。
 */
export const SETUP_DONE_MAX_AGE = 60 * 60 * 24 * 90;
