/**
 * Formula tokenizer.
 *
 * Turns formula source text into a flat token list. Pure string scanning —
 * there is deliberately no dynamic code construction anywhere in this engine:
 * no `eval`, no Function constructor, no dynamic import, and no `RegExp` built
 * from user input. Formulas are untrusted, tenant-supplied text that we
 * evaluate server-side.
 *
 * All errors are thrown as {@link FormulaSyntaxError} with a Japanese message
 * and a character offset; `parseFormula` catches them and converts them into a
 * `{ ok: false }` result, so nothing escapes to the caller.
 */

/** Hard cap on source length (safety requirement). */
export const MAX_SOURCE_LENGTH = 2000;
/** Hard cap on expression nesting depth (safety requirement). */
export const MAX_DEPTH = 32;
/** Hard cap on arguments to a variadic function (safety requirement). */
export const MAX_ARGS = 256;

export type TokenType =
  | "num" // 12, 3.5
  | "str" // 'abc', "abc"
  | "ident" // foo_bar, IF, AND, true
  | "field" // {売上}
  | "op" // + - * / % & = == != <> < <= > >= && ||
  | "punct" // ( ) ,
  | "eof";

export interface Token {
  type: TokenType;
  /** Raw lexeme for operators/idents, decoded content for str/field. */
  value: string;
  /** Parsed value for numeric literals. */
  num?: number;
  /** Character offset of the token start, for error reporting. */
  pos: number;
}

export class FormulaSyntaxError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "　";
}

/** Two-character operators must be matched before their one-character prefixes. */
const TWO_CHAR_OPS = new Set(["==", "!=", "<>", "<=", ">=", "&&", "||"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "&", "=", "<", ">"]);

/**
 * Scan `src` into tokens. Throws {@link FormulaSyntaxError} on bad input.
 * Always terminates: the cursor advances at least one character per loop.
 */
export function tokenize(src: string): Token[] {
  if (typeof src !== "string") {
    throw new FormulaSyntaxError("数式が文字列ではありません");
  }
  if (src.length > MAX_SOURCE_LENGTH) {
    throw new FormulaSyntaxError(
      `数式が長すぎます（最大${MAX_SOURCE_LENGTH}文字、現在${src.length}文字）`,
      MAX_SOURCE_LENGTH,
    );
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (isSpace(ch)) {
      i++;
      continue;
    }

    // --- field reference: {field_key} ------------------------------------
    if (ch === "{") {
      const start = i;
      const end = src.indexOf("}", i + 1);
      if (end === -1) {
        throw new FormulaSyntaxError("フィールド参照 { } が閉じられていません", start);
      }
      const key = src.slice(i + 1, end).trim();
      if (key === "") {
        throw new FormulaSyntaxError("フィールド参照 { } が空です", start);
      }
      tokens.push({ type: "field", value: key, pos: start });
      i = end + 1;
      continue;
    }

    if (ch === "}") {
      throw new FormulaSyntaxError("対応する { がない } があります", i);
    }

    // --- string literal ---------------------------------------------------
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\") {
          const next = src[i + 1];
          if (next === undefined) {
            break; // falls through to the unterminated error below
          }
          if (next === "n") out += "\n";
          else if (next === "t") out += "\t";
          else if (next === "r") out += "\r";
          else out += next; // \\ \' \" and anything else: literal
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        out += c;
        i++;
      }
      if (!closed) {
        throw new FormulaSyntaxError("文字列が閉じられていません", start);
      }
      tokens.push({ type: "str", value: out, pos: start });
      continue;
    }

    // --- number literal ---------------------------------------------------
    if (isDigit(ch)) {
      const start = i;
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === ".") {
        i++;
        if (!isDigit(src[i] ?? "")) {
          throw new FormulaSyntaxError("数値の書式が正しくありません", start);
        }
        while (i < src.length && isDigit(src[i])) i++;
      }
      const text = src.slice(start, i);
      const n = Number(text);
      if (!Number.isFinite(n)) {
        throw new FormulaSyntaxError("数値の書式が正しくありません", start);
      }
      // A number immediately followed by an identifier char (12abc) is a typo.
      if (i < src.length && isIdentStart(src[i])) {
        throw new FormulaSyntaxError(`数値の書式が正しくありません: ${text}${src[i]}`, start);
      }
      tokens.push({ type: "num", value: text, num: n, pos: start });
      continue;
    }

    // --- identifier / keyword --------------------------------------------
    if (isIdentStart(ch)) {
      const start = i;
      while (i < src.length && isIdentPart(src[i])) i++;
      tokens.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }

    // --- punctuation ------------------------------------------------------
    if (ch === "(" || ch === ")" || ch === ",") {
      tokens.push({ type: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    // --- operators --------------------------------------------------------
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ type: "op", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "!") {
      throw new FormulaSyntaxError("使用できない文字です: '!'（否定は NOT(...) を使ってください）", i);
    }

    throw new FormulaSyntaxError(`使用できない文字です: '${ch}'`, i);
  }

  tokens.push({ type: "eof", value: "", pos: src.length });
  return tokens;
}
