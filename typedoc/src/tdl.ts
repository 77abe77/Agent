import YAML from "yaml";

// Internal AST types for a practical subset of TDL 1.2
export type Literal = string | number | boolean;
export type PrimitiveName = "string" | "number" | "boolean" | "typedoc" | "image" | "audio" | "video" | "never";

export type TypeNode =
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "string-literal"; value: string }
  | { kind: "number-literal"; value: number }
  | { kind: "boolean-literal"; value: boolean }
  | { kind: "type-ref"; name: string }
  | { kind: "union"; members: TypeNode[] }
  | { kind: "intersection"; members: TypeNode[] }
  | { kind: "object"; props: PropNode[]; indexSigs: IndexSigNode[]; closed: boolean };

export interface PropNode {
  name: string;
  type: TypeNode;
  optional: boolean;
  isArray: boolean;
}

export interface IndexSigNode {
  kind: "string" | "enum";
  keys?: Literal[]; // only when kind==='enum'
  valueType: TypeNode;
  optional: boolean;
  isArray: boolean;
}

export interface TypeDef {
  name: string;
  node: TypeNode;
}

export interface SymbolDef {
  name: string;
  type: TypeNode;
  optional: boolean;
  isArray: boolean;
}

export interface TDLDoc {
  types: Map<string, TypeDef>;
  symbols: SymbolDef[];
  meta: Record<string, unknown>;
}

// Parsing

export function parseTDL(yamlText: string): TDLDoc {
  const raw = YAML.parse(yamlText);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("TDL document must be a YAML mapping at the top level");
  }

  const types = new Map<string, TypeDef>();
  const symbols: SymbolDef[] = [];
  const meta: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) {
      meta[k] = v;
      continue;
    }
    if (/^[A-Z][A-Za-z0-9]*\s*(?:\(.*\))?$/.test(k)) {
      // TypeName or Extends sugar like TypeName(Base & Other)
      const extendsMatch = k.match(/^([A-Z][A-Za-z0-9]*)\((.*)\)$/);
      if (extendsMatch) {
        const name = extendsMatch[1];
        const baseExpr = extendsMatch[2];
        if (!isObjectNode(v)) {
          throw new Error(`Type ${name} with extends sugar must have an object body`);
        }
        const base = parseTypeExpr(String(baseExpr));
        const body = parseInlineObject(v as Record<string, unknown>);
        const node: TypeNode = { kind: "intersection", members: [base, body] };
        types.set(name, { name, node });
        continue;
      }
      const name = k.trim();
      if (!isObjectNode(v) && typeof v !== "string") {
        throw new Error(`Type ${name} must be a scalar type expression or an inline object`);
      }
      const node = isObjectNode(v) ? parseInlineObject(v as Record<string, unknown>) : parseTypeExpr(String(v));
      types.set(name, { name, node });
      continue;
    }
    if (/^[a-z][A-Za-z0-9_]*([?\[\]]+)?$/.test(k)) {
      const { name, isArray, optional } = parseLabel(k);
      const type = isObjectNode(v) ? parseInlineObject(v as Record<string, unknown>) : parseTypeExpr(String(v));
      symbols.push({ name, type, optional, isArray });
      continue;
    }
    throw new Error(`Unrecognized top-level entry: ${k}`);
  }

  return { types, symbols, meta };
}

function isObjectNode(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseLabel(label: string): { name: string; isArray: boolean; optional: boolean } {
  const m = label.match(/^([a-z][A-Za-z0-9_]*)(.*)$/);
  if (!m) throw new Error(`Invalid label: ${label}`);
  const name = m[1];
  const tail = (m[2] || "").trim();
  let isArray = false;
  let optional = false;
  // tail can be '', '[]', '?', '?[]', '[]?'
  if (tail.includes("[]")) isArray = true;
  if (tail.includes("?")) optional = true;
  return { name, isArray, optional };
}

function parseIndexLabel(label: string): { domain: "string" | { kind: "enum"; keys: Literal[] }; optional: boolean; isArray: boolean } {
  const m = label.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\]]+)\](.*)$/);
  if (!m) throw new Error(`Invalid index signature label: ${label}`);
  const domainRaw = m[2].trim();
  const tail = (m[3] || "").trim();
  let isArray = false;
  let optional = false;
  if (tail.includes("[]")) isArray = true;
  if (tail.includes("?")) optional = true;

  if (domainRaw === "string") {
    return { domain: "string", optional, isArray };
  }
  const keys = parseEnumLike(domainRaw);
  return { domain: { kind: "enum", keys }, optional, isArray };
}

function parseEnumLike(expr: string): Literal[] {
  const parts = splitTopLevel(expr, "|").map((s) => s.trim()).filter(Boolean);
  const keys: Literal[] = [];
  for (const p of parts) {
    const lit = tryParseLiteral(p);
    if (lit !== undefined) {
      keys.push(lit);
      continue;
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(p)) {
      keys.push(p);
      continue;
    }
    throw new Error(`Enum-like expression must be literals or ALL_CAPS_TOKENs: ${expr}`);
  }
  return keys;
}

export function parseInlineObject(obj: Record<string, unknown>): TypeNode {
  const props: PropNode[] = [];
  const indexSigs: IndexSigNode[] = [];
  let closed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("[")) {
      const { domain, optional, isArray } = parseIndexLabel(k);
      const valueType = isObjectNode(v) ? parseInlineObject(v as Record<string, unknown>) : parseTypeExpr(String(v));
      if (domain === "string") {
        // Closure sugar: [k: string]? never
        if (optional && isNever(valueType)) {
          closed = true;
          continue; // do not keep the never-signature
        }
        indexSigs.push({ kind: "string", valueType, optional, isArray });
      } else {
        // enum-like domain
        indexSigs.push({ kind: "enum", keys: domain.keys, valueType, optional, isArray });
      }
      continue;
    }
    const { name, isArray, optional } = parseLabel(k);
    const type = isObjectNode(v) ? parseInlineObject(v as Record<string, unknown>) : parseTypeExpr(String(v));
    props.push({ name, type, optional, isArray });
  }
  return { kind: "object", props, indexSigs, closed };
}

function isNever(t: TypeNode): boolean {
  return t.kind === "primitive" && t.name === "never";
}

export function parseTypeExpr(expr: string): TypeNode {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("Empty type expression");

  // Quick unsupported checks
  if (/=>/.test(trimmed)) throw new Error(`Function types are not supported: ${expr}`);
  if (/\bif\b|\bthen\b|\belse\b/.test(trimmed)) throw new Error(`Conditionals are not supported: ${expr}`);
  if (trimmed.includes("::")) throw new Error(`Qualified imports are not supported: ${expr}`);
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*<.*>$/.test(trimmed)) {
    // Any generic usage including Ref<T>
    if (/^Ref\s*</.test(trimmed)) {
      return { kind: "primitive", name: "string" }; // Ref lowered to string
    }
    throw new Error(`Generics are not supported in this converter: ${expr}`);
  }

  // Union
  const unionParts = splitTopLevel(trimmed, "|");
  if (unionParts.length > 1) {
    return { kind: "union", members: unionParts.map((p) => parseTypeExpr(p)) };
  }
  // Intersection
  const andParts = splitTopLevel(trimmed, "&");
  if (andParts.length > 1) {
    return { kind: "intersection", members: andParts.map((p) => parseTypeExpr(p)) };
  }

  // Parenthesized
  if (trimmed.startsWith("(") && trimmed.endsWith(")") && isBalancedParens(trimmed)) {
    return parseTypeExpr(trimmed.slice(1, -1));
  }

  // Literal or primitive or ref or type-ref
  const lit = tryParseLiteral(trimmed);
  if (lit !== undefined) return literalToNode(lit);

  if (/^(string|number|boolean|typedoc|image|audio|video|never)$/.test(trimmed)) {
    return { kind: "primitive", name: trimmed as PrimitiveName };
  }

  if (/^[A-Z][A-Za-z0-9]*$/.test(trimmed)) {
    return { kind: "type-ref", name: trimmed };
  }

  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    // Treat ALL_CAPS token as string literal value
    return { kind: "string-literal", value: trimmed };
  }

  throw new Error(`Unsupported or unrecognized type expression: ${expr}`);
}

function literalToNode(v: Literal): TypeNode {
  if (typeof v === "string") return { kind: "string-literal", value: v };
  if (typeof v === "number") return { kind: "number-literal", value: v };
  return { kind: "boolean-literal", value: v };
}

function tryParseLiteral(x: string): Literal | undefined {
  const s = x.trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return undefined;
}

function isBalancedParens(s: string): boolean {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") d++;
    else if (c === ")") d--;
    if (d < 0) return false;
  }
  return d === 0;
}

export function splitTopLevel(s: string, sep: "|" | "&"): string[] {
  const parts: string[] = [];
  let depthParen = 0;
  let depthAngle = 0;
  let cur = "";
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === inStr && s[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch as '"' | "'";
      cur += ch;
      continue;
    }
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen--;
    else if (ch === "<") depthAngle++;
    else if (ch === ">") depthAngle--;

    if (depthParen === 0 && depthAngle === 0 && ch === sep) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length) parts.push(cur.trim());
  return parts;
}
