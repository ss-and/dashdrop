/**
 * 常駐する設定ガイドの「出る / 出ない」。
 *
 * 判定そのもの（何が済んだか）は tests/onboarding.test.ts で固めてあるので、
 * ここで見るのは**居座らないこと**だけ。ガイドの失敗はいつも同じ形で出る——
 * 閉じたのに次の画面でまた出る、全部終わったのに消えない、覚えの無い人にまで
 * 「ひととおり終わりました」と言う。どれも本人は報告せず、ただ黙って嫌う。
 *
 * localStorage は tests/setup.ts が本物と同じ振る舞いの実装を入れている
 * （jsdom のものは setItem すら生えていない）。保存できていないことを
 * 見抜けるようにするための仕掛けなので、ここではそれに乗る。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SetupGuide } from "@/components/app/SetupGuide";
import { SETUP_DONE_COOKIE } from "@/lib/onboarding";
import { onboardingSteps, type OnboardingState } from "@/lib/onboarding";

const WS = "ws_test";

const EMPTY: OnboardingState = {
  workbooks: 0,
  dashboards: 0,
  records: 0,
  sharedDashboards: 0,
  emailVerified: false,
};

const FULL: OnboardingState = {
  workbooks: 1,
  dashboards: 1,
  records: 1,
  sharedDashboards: 1,
  emailVerified: true,
};

function show(state: OnboardingState) {
  return render(
    <SetupGuide workspaceId={WS} steps={onboardingSteps(state)} />,
  );
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SetupGuide", () => {
  it("やることが残っていれば出る。次の一手は「次: 」で名指しする", () => {
    show(EMPTY);
    expect(screen.getByLabelText("設定ガイド")).toBeInTheDocument();
    expect(screen.getByText("次: Excelを取り込む")).toBeInTheDocument();
    expect(screen.getByText("0/5")).toBeInTheDocument();
  });

  it("済んだ課題にはチェックが付き、リンクではなくなる", () => {
    show({ ...EMPTY, workbooks: 2 });
    // 済んだものは押す先に用が無いのでリンクを張らない。
    expect(screen.queryByRole("link", { name: /Excelを取り込む/ })).toBeNull();
    expect(screen.getByText("1/5")).toBeInTheDocument();
    expect(screen.getByText("次: 表の中身を見る")).toBeInTheDocument();
  });

  it("畳むと見出しだけになる（進捗バーは残す）", () => {
    show(EMPTY);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("次: Excelを取り込む")).toBeNull();
    expect(screen.getByText("0/5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("閉じたら、次に開いた画面でも出てこない", () => {
    show(EMPTY);
    fireEvent.click(screen.getByLabelText("設定ガイドを閉じる"));
    expect(screen.queryByLabelText("設定ガイド")).toBeNull();

    // 別ページへ移った＝作り直された、と同じこと。
    cleanup();
    show(EMPTY);
    expect(screen.queryByLabelText("設定ガイド")).toBeNull();
  });

  it("最初から全部済んでいる人には何も出さない（覚えの無い完了報告をしない）", () => {
    show(FULL);
    expect(screen.queryByLabelText("設定ガイド")).toBeNull();
  });

  it("見ていた人が終えたときだけ挨拶し、それも一度きり", () => {
    show(EMPTY);
    cleanup();

    show(FULL);
    expect(screen.getByText("ひととおり終わりました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("ひととおり終わりました")).toBeNull();

    cleanup();
    show(FULL);
    expect(screen.queryByText("ひととおり終わりました")).toBeNull();
  });

  it("ワークスペースごとに覚える（別のワークスペースまで黙らせない）", () => {
    show(EMPTY);
    fireEvent.click(screen.getByLabelText("設定ガイドを閉じる"));
    cleanup();

    render(
      <SetupGuide workspaceId="ws_other" steps={onboardingSteps(EMPTY)} />,
    );
    expect(screen.getByLabelText("設定ガイド")).toBeInTheDocument();
  });
});

/**
 * 設定ガイドの材料を集めるクエリは、全ページ共通の器に乗っている。終えた人が
 * もう出ないパネルのために毎ページ払い続けないよう、完了を Cookie に残す。
 */
describe("終えたら、次からは数えさせない", () => {
  beforeEach(() => {
    // 同名の Cookie を消してから始める（jsdom は同一ドキュメントを使い回す）。
    document.cookie = `${SETUP_DONE_COOKIE}=; path=/; max-age=0`;
  });

  it("全部済んだら印を残す", () => {
    const steps = onboardingSteps({
      workbooks: 1,
      dashboards: 1,
      records: 1,
      sharedDashboards: 1,
      emailVerified: true,
    });
    render(<SetupGuide workspaceId="ws-done" steps={steps} />);
    expect(document.cookie).toContain(`${SETUP_DONE_COOKIE}=1`);
  });

  it("まだ残っているうちは印を残さない", () => {
    const steps = onboardingSteps({
      workbooks: 0,
      dashboards: 0,
      records: 0,
      sharedDashboards: 0,
      emailVerified: false,
    });
    render(<SetupGuide workspaceId="ws-wip" steps={steps} />);
    expect(document.cookie).not.toContain(`${SETUP_DONE_COOKIE}=1`);
  });

  /**
   * サーバーが層を飛ばして steps を空で渡してくるのは「もう印がある」という
   * 意味。そこで書き直すと、印が無い状態からでも印が付いてしまい、数え直しの
   * 機会（90日で切れる）を自分で潰すことになる。
   */
  it("サーバーが数えなかった（steps が空）ときは印を書かない", () => {
    render(<SetupGuide workspaceId="ws-skipped" steps={[]} />);
    expect(document.cookie).not.toContain(`${SETUP_DONE_COOKIE}=1`);
  });
});
