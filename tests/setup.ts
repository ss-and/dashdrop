import "@testing-library/jest-dom/vitest";

// Provide env defaults so modules importing `@/lib/env` don't throw in tests.
// (NODE_ENV is set to "test" by Vitest automatically and is read-only in types.)
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-32chars";
process.env.DATABASE_URL ??= "file:./test.db";

/*
 * jsdom の localStorage。
 *
 * この構成の jsdom は `window.localStorage` に**中身の無いオブジェクト**を
 * 置いており、`setItem` すら生えていない（`about:blank` 相当の扱いのため）。
 * 実装側は「使えなければ諦める」形で書いてあるので製品は動くが、
 * それでは**保存できていないことをテストが見抜けない**——常に空を読むので、
 * 期待どおりに空が返ってしまう。
 *
 * そこで、本物と同じ振る舞いをする最小の Storage を入れておく。
 * 既に使えるものがあれば触らない。
 */
function installMemoryStorage() {
  const ls = (globalThis as { localStorage?: unknown }).localStorage;
  if (ls && typeof (ls as Storage).setItem === "function") return;

  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    // 本物と同じく、値は必ず文字列になる。
    setItem: (k, v) => void map.set(String(k), String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}
installMemoryStorage();
