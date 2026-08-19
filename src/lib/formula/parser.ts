/**
 * Recursive-descent parser for the formula language.
 *
 * Grammar (lowest precedence first, every binary level left-associative):
 *
 *   expr    := orExpr
 *   orExpr  := andExpr  (("OR"  | "||") andExpr)*
 *   andExpr := cmpExpr  (("AND" | "&&") cmpExpr)*
 *   cmpExpr := addExpr  (("=" | "==" | "!=" | "<>" | "<" | "<=" | ">" | ">=") addExpr)*
 *   addExpr := mulExpr  (("+" | "-" | "&") mulExpr)*        // "&" = 文字列連結
 *   mulExpr := unary    (("*" | "/" | "%") unary)*
 *   unary   := ("-" | "+")* primary                          // iterative, never recurses
 *   primary := number | string | "true" | "false" | "null"
 *            | "{" field "}" | ident | ident "(" args ")" | "(" expr ")"
 *
 * Safety: nesting depth is capped at MAX_DEPTH (32) and argument counts at
 * MAX_ARGS (256) at parse time, so a hostile formula can neither blow the
 * stack here nor produce an AST the evaluator would have to walk deeply.
 */
import {
  tokenize,
  FormulaSyntaxError,
  MAX_ARGS,
  MAX_DEPTH,
  MAX_SOURCE_LENGTH,
  type Token,
} from "./tokenizer";
import { findFn, type FormulaValue } from "./functions";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "&"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">=";

export type AstNode =
  | { kind: "lit"; value: FormulaValue }
  | { kind: "field"; key: string }
  | { kind: "unary"; op: "-" | "+"; operand: AstNode }
  | { kind: "binary"; op: BinaryOp; left: AstNode; right: AstNode }
  | { kind: "logical"; op: "AND" | "OR"; left: AstNode; right: AstNode }
  | { kind: "if"; cond: AstNode; then: AstNode; other: AstNode }
  | { kind: "call"; name: string; args: AstNode[] };

/** Opaque to callers — pass it straight back to `evaluateFormula`. */
export type FormulaAst = AstNode;

export interface ParseOk {
  ok: true;
  ast: FormulaAst;
  /** Referenced field keys, deduped, in first-appearance order. */
  refs: string[];
}
export interface ParseErr {
  ok: false;
  /** Japanese, user-facing. */
  error: string;
  position?: number;
}
export type ParseResult = ParseOk | ParseErr;

/** Comparison operators, normalised to a canonical form. */
const CMP_OPS: Record<string, BinaryOp> = {
  "=": "=",
  "==": "=",
  "!=": "!=",
  "<>": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};

function describe(tok: Token): string {
  switch (tok.type) {
    case "eof":
      return "式の終わり";
    case "str":
      return `文字列 "${tok.value}"`;
    case "field":
      return `フィールド {${tok.value}}`;
    default:
      return `"${tok.value}"`;
  }
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private depth = 0;
  readonly refs: string[] = [];
  private readonly seen = new Set<string>();

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const t = this.tokens[this.pos + offset];
    return t ?? this.tokens[this.tokens.length - 1];
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== "eof") this.pos++;
    return t;
  }

  private fail(message: string, tok?: Token): never {
    throw new FormulaSyntaxError(message, tok?.pos);
  }

  private addRef(key: string): void {
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.refs.push(key);
    }
  }

  /** True when the current token is the operator keyword `word` (AND/OR). */
  private isKeywordOp(word: "AND" | "OR"): boolean {
    const t = this.peek();
    if (t.type === "op") return word === "AND" ? t.value === "&&" : t.value === "||";
    if (t.type !== "ident") return false;
    if (t.value.toUpperCase() !== word) return false;
    // `AND(a, b)` is a function call, not the infix operator.
    return !(this.peek(1).type === "punct" && this.peek(1).value === "(");
  }

  parseProgram(): AstNode {
    if (this.peek().type === "eof") {
      this.fail("数式が空です", this.peek());
    }
    const node = this.parseExpr();
    const rest = this.peek();
    if (rest.type !== "eof") {
      this.fail(`予期しないトークンです: ${describe(rest)}`, rest);
    }
    return node;
  }

  /** Entry point of every nesting level — this is where depth is enforced. */
  private parseExpr(): AstNode {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      this.fail(
        `式のネストが深すぎます（最大${MAX_DEPTH}段）`,
        this.peek(),
      );
    }
    const node = this.parseOr();
    this.depth--;
    return node;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.isKeywordOp("OR")) {
      this.next();
      const right = this.parseAnd();
      left = { kind: "logical", op: "OR", left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseCmp();
    while (this.isKeywordOp("AND")) {
      this.next();
      const right = this.parseCmp();
      left = { kind: "logical", op: "AND", left, right };
    }
    return left;
  }

  private parseCmp(): AstNode {
    let left = this.parseAdd();
    for (;;) {
      const t = this.peek();
      if (t.type !== "op") break;
      const op = CMP_OPS[t.value];
      if (!op) break;
      this.next();
      const right = this.parseAdd();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdd(): AstNode {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.type !== "op" || (t.value !== "+" && t.value !== "-" && t.value !== "&")) break;
      this.next();
      const right = this.parseMul();
      left = { kind: "binary", op: t.value as BinaryOp, left, right };
    }
    return left;
  }

  private parseMul(): AstNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type !== "op" || (t.value !== "*" && t.value !== "/" && t.value !== "%")) break;
      this.next();
      const right = this.parseUnary();
      left = { kind: "binary", op: t.value as BinaryOp, left, right };
    }
    return left;
  }

  /**
   * Prefix +/-. Collected in a loop (not by recursion) so that a pathological
   * `-------1` costs stack depth 0 rather than one frame per sign.
   */
  private parseUnary(): AstNode {
    const ops: Array<"-" | "+"> = [];
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "-" || t.value === "+")) {
        ops.push(t.value);
        this.next();
        continue;
      }
      break;
    }
    let node = this.parsePrimary();
    for (let i = ops.length - 1; i >= 0; i--) {
      node = { kind: "unary", op: ops[i], operand: node };
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.next();
    if (t.type === "eof") {
      this.fail("数式が途中で終わっています", t);
    }

    switch (t.type) {
      case "num":
        return { kind: "lit", value: t.num ?? 0 };

      case "str":
        return { kind: "lit", value: t.value };

      case "field":
        this.addRef(t.value);
        return { kind: "field", key: t.value };

      case "punct":
        if (t.value === "(") {
          const inner = this.parseExpr();
          const close = this.peek();
          if (close.type !== "punct" || close.value !== ")") {
            this.fail("閉じ括弧 ) がありません", close);
          }
          this.next();
          return inner;
        }
        if (t.value === ")") {
          this.fail("対応する ( がない ) があります", t);
        }
        this.fail(`予期しないトークンです: ${describe(t)}`, t);
        break;

      case "ident": {
        const upper = t.value.toUpperCase();
        const isCall = this.peek().type === "punct" && this.peek().value === "(";
        if (!isCall) {
          if (upper === "TRUE") return { kind: "lit", value: true };
          if (upper === "FALSE") return { kind: "lit", value: false };
          if (upper === "NULL") return { kind: "lit", value: null };
          // A bare identifier is a field reference (`sales` === `{sales}`).
          this.addRef(t.value);
          return { kind: "field", key: t.value };
        }
        return this.parseCall(t);
      }

      case "op":
        this.fail(`演算子の位置が正しくありません: "${t.value}"`, t);
        break;

      default:
        this.fail(`予期しないトークンです: ${describe(t)}`, t);
    }
    // Unreachable — every branch above returns or throws.
    this.fail("数式を解析できません", t);
  }

  private parseCall(nameTok: Token): AstNode {
    const upper = nameTok.value.toUpperCase();
    const def = findFn(upper);
    if (!def) {
      this.fail(`関数 ${upper} は使用できません`, nameTok);
    }
    this.next(); // consume "("

    const args: AstNode[] = [];
    if (this.peek().type === "punct" && this.peek().value === ")") {
      this.next();
    } else {
      for (;;) {
        if (args.length >= MAX_ARGS) {
          this.fail(
            `関数 ${upper} の引数が多すぎます（最大${MAX_ARGS}個）`,
            this.peek(),
          );
        }
        args.push(this.parseExpr());
        const sep = this.peek();
        if (sep.type === "punct" && sep.value === ",") {
          this.next();
          continue;
        }
        if (sep.type === "punct" && sep.value === ")") {
          this.next();
          break;
        }
        this.fail(`関数 ${upper} の引数リストが閉じられていません`, sep);
      }
    }

    if (args.length < def.minArgs || args.length > def.maxArgs) {
      const expected =
        def.minArgs === def.maxArgs
          ? `${def.minArgs}個`
          : def.maxArgs >= MAX_ARGS
            ? `${def.minArgs}個以上`
            : `${def.minArgs}〜${def.maxArgs}個`;
      this.fail(
        `関数 ${upper} の引数の数が正しくありません（${expected}必要ですが${args.length}個です）`,
        nameTok,
      );
    }

    if (upper === "IF") {
      return { kind: "if", cond: args[0], then: args[1], other: args[2] };
    }
    return { kind: "call", name: upper, args };
  }
}

/**
 * Parse source text into an AST. Never throws — every failure comes back as
 * `{ ok: false, error, position? }` with a Japanese message.
 */
export function parseFormula(src: string): ParseResult {
  try {
    if (typeof src !== "string") {
      return { ok: false, error: "数式が文字列ではありません" };
    }
    if (src.trim() === "") {
      return { ok: false, error: "数式が空です", position: 0 };
    }
    if (src.length > MAX_SOURCE_LENGTH) {
      return {
        ok: false,
        error: `数式が長すぎます（最大${MAX_SOURCE_LENGTH}文字、現在${src.length}文字）`,
        position: MAX_SOURCE_LENGTH,
      };
    }
    const parser = new Parser(tokenize(src));
    const ast = parser.parseProgram();
    return { ok: true, ast, refs: parser.refs };
  } catch (err) {
    if (err instanceof FormulaSyntaxError) {
      return err.position === undefined
        ? { ok: false, error: err.message }
        : { ok: false, error: err.message, position: err.position };
    }
    // Defensive: nothing else should escape, but never leak an internal error.
    return { ok: false, error: "数式を解析できませんでした" };
  }
}

/**
 * Parse + check that every referenced key exists among `availableKeys`.
 * Returns a Japanese error naming the first unknown field when it does not.
 */
export function validateFormula(
  src: string,
  availableKeys: string[],
): { ok: true; refs: string[] } | { ok: false; error: string } {
  const parsed = parseFormula(src);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const known = new Set(Array.isArray(availableKeys) ? availableKeys : []);
  for (const ref of parsed.refs) {
    if (!known.has(ref)) {
      return { ok: false, error: `フィールド {${ref}} が見つかりません` };
    }
  }
  return { ok: true, refs: parsed.refs };
}
