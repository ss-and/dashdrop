"use client";

import { useEffect } from "react";
import { rememberRecent, type RecentKind } from "@/lib/recent";

/**
 * 「ここを見た」を端末に記録するだけの部品。画面には何も描かない。
 *
 * サーバー側のページから名前ごと渡してもらう。ここで改めて取りに行くと、
 * 表示するわけでもない情報のために1リクエスト増える。
 *
 * 依存配列に href と name を入れてあるので、同じ画面のまま名前が変わった
 * ときも（改名して router.refresh した場合など）記録が追従する。
 */
export function RememberVisit({
  workspaceId,
  kind,
  href,
  name,
  sub,
}: {
  workspaceId: string;
  kind: RecentKind;
  href: string;
  name: string;
  sub?: string;
}) {
  useEffect(() => {
    rememberRecent(workspaceId, { kind, href, name, sub });
  }, [workspaceId, kind, href, name, sub]);

  return null;
}
