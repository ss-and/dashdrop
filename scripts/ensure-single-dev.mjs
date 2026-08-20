#!/usr/bin/env node
/**
 * 開発サーバーの二重起動を止める。
 *
 * `next dev` を2つ動かすと、両方が同じ `.next` に書き込む。片方が生成した
 * チャンクをもう片方が上書きするため、先に動いていた側で CSS や JS が 404 になり、
 * 画面はスタイルの当たっていない素の HTML になる。エラーは出ないので、原因が
 * まったく分からないまま「アプリが壊れた」ように見える——実際に3回起きた。
 *
 * Next 自体は「ポートが使用中なので 3001 を使います」と言って**起動してしまう**。
 * 一見親切だが、`.next` は共有されたままなので事故はここから始まる。
 * だからポートが塞がっていたら、その時点で止める。
 */
import net from "node:net";

const PORT = Number(process.env.PORT ?? 3000);

/** 接続できる＝誰かが待ち受けている。 */
function inUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

if (await inUse(PORT)) {
  console.error(
    [
      "",
      `\x1b[31m開発サーバーは既に http://localhost:${PORT} で動いています。\x1b[0m`,
      "",
      "2つ目を起動すると、両方が同じ .next に書き込んで、先に動いていた方の",
      "CSS/JS が 404 になります（画面が素の HTML になります）。",
      "",
      "  ・そのまま使う          … ブラウザで http://localhost:" + PORT + " を開く",
      "  ・立て直す              … 動いている方を Ctrl+C で止めてから、もう一度 npm run dev",
      "  ・別ポートで動かしたい  … PORT=3100 npm run dev",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
