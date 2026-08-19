/**
 * `server-only` のテスト用スタブ。
 *
 * 本物は next/dist/compiled の中にしか無く、vitest からは解決できない。
 * これが無いと `import "server-only"` を持つモジュールをテストから読めず、
 * 「テストのために import を外す」という本末転倒が起きる（実際に一度起きた）。
 * ビルド時のクライアント境界チェックは Next 側が本物で行うので、ここは空でよい。
 */
export {};
