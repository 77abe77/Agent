import type { TDLDoc, TypeNode, PropNode, IndexSigNode, Literal } from "./tdl";

// Gemini jsonschema_gemini generator
// Differences from OpenAI generator:
// - Objects honor TDL openness: open-by-default; closure with [k: string]? never
// - additionalProperties can be true or a schema (for string maps)
// - Optional properties are not forced into required
// - anyOf, $defs, $ref supported

export function generateGeminiSchema(doc: TDLDoc): Record<string, unknown> {
  const ctx = new EmitCtxGemini(doc);
  for (const [name] of doc.types) ctx.ensureDef(name);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const sym of doc.symbols) {
    const base = ctx.emit(sym.type);
    const withArray = sym.isArray ? arrayOf(base) : base;
    properties[sym.name] = sym.optional ? withArray : withArray;
    if (!sym.optional) required.push(sym.name);
  }

  const root = {
    type: "object",
    properties,
    required,
    additionalProperties: false, // Gemini requires explicit additionalProperties, but for root we keep closed output contract
    $defs: Object.fromEntries(ctx.defs)
  } as Record<string, unknown>;

  return root;
}

class EmitCtxGemini {
  defs: Map<string, unknown> = new Map();
  stack: Set<string> = new Set();
  constructor(public doc: TDLDoc) {}

  ensureDef(name: string) {
    if (this.defs.has(name)) return;
    if (this.stack.has(name)) {
      this.defs.set(name, { type: "object", properties: {}, required: [], additionalProperties: true });
      return;
    }
    const def = this.doc.types.get(name);
    if (!def) throw new Error(`Unknown type reference: ${name}`);
    this.stack.add(name);
    const schema = this.emit(def.node);
    this.stack.delete(name);
    this.defs.set(name, schema);
  }

  emit(node: TypeNode): Record<string, unknown> {
    switch (node.kind) {
      case "primitive":
        return primitiveToSchema(node.name);
      case "string-literal":
        return { type: "string", enum: [node.value] };
      case "number-literal":
        return { type: "number", enum: [node.value] };
      case "boolean-literal":
        return { type: "boolean", enum: [node.value] };
      case "type-ref":
        this.ensureDef(node.name);
        return { $ref: `#/$defs/${node.name}` };
      case "union":
        if (node.members.every(isScalarLiteral)) {
          const enums = node.members.map((m) => literalValue(m));
          const type = unionLiteralType(enums);
          const base: Record<string, unknown> = { enum: enums };
          if (type) base.type = type;
          return base;
        }
        return { anyOf: node.members.map((m) => this.emit(m)) };
      case "intersection":
        return this.emitObject(mergeObjects(this, node.members));
      case "object":
        return this.emitObject(node);
    }
  }

  emitObject(obj: Extract<TypeNode, { kind: "object" }>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    let additionalProps: boolean | Record<string, unknown> = obj.closed ? false : true;

    for (const idx of obj.indexSigs) {
      if (idx.kind === "string") {
        // Gemini can express maps via additionalProperties: schema
        if (!(idx.optional && isNever(this.emit(idx.valueType)))) {
          const base = this.emit(idx.valueType);
          const valSchema = idx.isArray ? arrayOf(base) : base;
          additionalProps = valSchema; // last-one-wins per intersection semantics
        } else {
          additionalProps = false;
        }
        continue;
      }
      // enum-like domain -> materialize concrete keys
      for (const key of idx.keys || []) {
        const keyName = String(key);
        const base = this.emit(idx.valueType);
        const withArray = idx.isArray ? arrayOf(base) : base;
        properties[keyName] = withArray;
        if (!idx.optional) required.push(keyName);
      }
    }

    for (const p of obj.props) {
      const base = this.emit(p.type);
      const withArray = p.isArray ? arrayOf(base) : base;
      properties[p.name] = withArray;
      if (!p.optional) required.push(p.name);
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: additionalProps
    };
  }
}

function primitiveToSchema(name: string): Record<string, unknown> {
  switch (name) {
    case "string":
    case "typedoc":
    case "image":
    case "audio":
    case "video":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "never":
      return { type: "number", minimum: 1, maximum: 0 };
    default:
      return { type: "string" };
  }
}

function arrayOf(item: Record<string, unknown>): Record<string, unknown> {
  return { type: "array", items: item };
}

function isScalarLiteral(n: TypeNode): boolean {
  return n.kind === "string-literal" || n.kind === "number-literal" || n.kind === "boolean-literal";
}

function literalValue(n: TypeNode): string | number | boolean {
  switch (n.kind) {
    case "string-literal":
      return n.value;
    case "number-literal":
      return n.value;
    case "boolean-literal":
      return n.value;
    default:
      throw new Error("not a literal");
  }
}

function unionLiteralType(values: Array<string | number | boolean>): string | undefined {
  const types = new Set(values.map((v) => typeof v));
  if (types.size === 1) {
    const t = types.values().next().value as string;
    if (t === "string" || t === "number" || t === "boolean") return t;
  }
  return undefined;
}

function isNever(s: Record<string, unknown>): boolean {
  return s.type === "number" && typeof (s as any).minimum === "number" && typeof (s as any).maximum === "number" && (s as any).minimum > (s as any).maximum;
}

function mergeObjects(ctx: EmitCtxGemini, parts: TypeNode[]): Extract<TypeNode, { kind: "object" }> {
  const outProps: Map<string, PropNode> = new Map();
  const outIdx: IndexSigNode[] = [];
  let closed = false;

  for (const p of parts) {
    const obj = resolveObject(ctx, p);
    closed = closed || obj.closed;
    for (const ip of obj.props) outProps.set(ip.name, ip);
    for (const is of obj.indexSigs) outIdx.push(is);
  }
  return { kind: "object", props: Array.from(outProps.values()), indexSigs: outIdx, closed };
}

function resolveObject(ctx: EmitCtxGemini, node: TypeNode): Extract<TypeNode, { kind: "object" }> {
  if (node.kind === "object") return node;
  if (node.kind === "type-ref") {
    const def = ctx.doc.types.get(node.name);
    if (!def) throw new Error(`Unknown type: ${node.name}`);
    return resolveObject(ctx, def.node);
  }
  if (node.kind === "intersection") return mergeObjects(ctx, node.members);
  throw new Error("Intersection operands must be object-like");
}
