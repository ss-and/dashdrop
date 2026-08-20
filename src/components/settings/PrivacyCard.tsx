"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";

/**
 * AI に中身を渡してよいかの設定。
 *
 * 取り込みのときに列名と各列のサンプル値（数件）が Anthropic へ渡る。行データ
 * 全体は送らないが、「列名は社外秘」という会社は普通にある。切れることと、
 * 切ったときに何が変わるかを、同じ場所に書いておく。
 */
export function PrivacyCard({
  initialAiEnabled,
  canEdit,
}: {
  initialAiEnabled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialAiEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const previous = enabled;
    setEnabled(next);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiEnabled: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "変更に失敗しました");
      router.refresh();
    } catch (e) {
      // 反映できていないのに、切り替わったように見せない。
      setEnabled(previous);
      setError(e instanceof Error ? e.message : "変更に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AIによる提案</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit || busy}
            onChange={(e) => void toggle(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-khaki-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              取り込み時に、AIに項目名を提案させる
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
              列名と、各列のサンプル値（数件）が Anthropic の API に送信されます。
              行データ全体は送信しません。
              <br />
              オフにすると通信そのものを行わず、決まったルールだけで提案を作ります
              （シートの取捨、項目名・型の推定、確認したいことの提示は、これまでどおり動きます）。
            </span>
          </span>
        </label>

        {!canEdit && (
          <p className="text-xs text-ink-muted">
            この設定を変更できるのは管理者のみです。
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <p className="text-xs text-ink-muted">
          詳しくは{" "}
          <Link href="/privacy" className="text-khaki-700 hover:underline">
            プライバシーポリシー
          </Link>{" "}
          をご確認ください。
        </p>
      </CardBody>
    </Card>
  );
}
