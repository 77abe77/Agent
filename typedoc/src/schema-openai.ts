import type { TDLDoc, TypeNode, PropNode, IndexSigNode } from "./tdl";

// OpenAI Structured Outputs subset generator
// Constraints we honor:
// - Root must be an object, not anyOf
// - All object schemas include additionalProperties: false
// - All fields required; optional fields encoded as nullable (type union with "null")
// - Supported: $defs, $ref, anyOf (nested)

export function generateOpenAISchema(doc: TDLDoc): Record<string, unknown> {
  const ctx = new EmitCtxOpenAI(doc);

  // Emit $defs for all named types proactively (or lazily during ref emission)
  for (const [name] of doc.types) ctx.ensureDef(name);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const sym of doc.symbols) {
    const baseSchema = ctx.emit(sym.type);
    const withArray = sym.isArray ? arrayOf(baseSchema) : baseSchema;
    const finalSchema = sym.optional ? makeNullable(withArray) : withArray;
    properties[sym.name] = finalSchema;
    required.push(sym.name); // OpenAI requires all properties to be required
  }

  const root = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
    $defs: Object.fromEntries(ctx.defs)
  } as Record<string, unknown>;

  return root;
}

class EmitCtxOpenAI {
  defs: Map<string, unknown> = new Map();
  stack: Set<string> = new Set();
  constructor(public doc: TDLDoc) {}

  ensureDef(name: string) {
    if (this.defs.has(name)) return;
    if (this.stack.has(name)) {
      // Recursive type; emit placeholder object to break cycles
      this.defs.set(name, { type: "object", properties: {}, required: [], additionalProperties: false });
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
        // If all are literal scalars, compress to enum
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

    // Index signatures: only support enum-like domains (emit as concrete properties).
    for (const idx of obj.indexSigs) {
      if (idx.kind === "string") {
        // OpenAI Structured Outputs cannot represent dynamic maps; only accept closure sugar
        if (!(idx.optional && isNeverSchema(this.emit(idx.valueType)))) {
          throw new Error("OpenAI schema: string index signatures (maps) are not supported. Use [k: string]? never for closure.");
        }
        continue;
      }
      // enum-like domain -> emit concrete properties
      for (const key of idx.keys || []) {
        const keyName = String(key);
        const base = this.emit(idx.valueType);
        const withArray = idx.isArray ? arrayOf(base) : base;
        properties[keyName] = idx.optional ? makeNullable(withArray) : withArray;
        required.push(keyName); // still required; optional -> nullable
      }
    }

    for (const p of obj.props) {
      const base = this.emit(p.type);
      const withArray = p.isArray ? arrayOf(base) : base;
      properties[p.name] = p.optional ? makeNullable(withArray) : withArray;
      required.push(p.name); // OpenAI requires all properties to be present (nullable if optional)
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
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
      // Unsatisfiable approximation using contradictory constraints
      return { type: "number", minimum: 1, maximum: 0 };
    default:
      return { type: "string" };
  }
}

function arrayOf(item: Record<string, unknown>): Record<string, unknown> {
  return { type: "array", items: item };
}

function makeNullable(schema: Record<string, unknown>): Record<string, unknown> {
  // Prefer type union when possible, otherwise anyOf
  const t = (schema as any).type;
  if (typeof t === "string") {
    return { ...schema, type: [t, "null"] };
  }
  if (Array.isArray(t)) {
    if (!t.includes("null")) return { ...schema, type: [...t, "null"] };
    return schema;
  }
  return { anyOf: [schema, { type: "null" }] };
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

function isNeverSchema(s: Record<string, unknown>): boolean {
  // Detect our never encoding: number with min>max
  return (
    (s.type === "number" && typeof (s as any).minimum === "number" && typeof (s as any).maximum === "number" && (s as any).minimum > (s as any).maximum) ||
    false
  );
}

function mergeObjects(ctx: EmitCtxOpenAI, parts: TypeNode[]): Extract<TypeNode, { kind: "object" }> {
  const outProps: Map<string, PropNode> = new Map();
  const outIdx: IndexSigNode[] = [];
  let closed = false;

  for (const p of parts) {
    const obj = resolveObject(ctx, p);
    closed = closed || obj.closed;
    for (const ip of obj.props) {
      outProps.set(ip.name, ip);
    }
    for (const is of obj.indexSigs) outIdx.push(is);
  }
  return { kind: "object", props: Array.from(outProps.values()), indexSigs: outIdx, closed };
}

function resolveObject(ctx: EmitCtxOpenAI, node: TypeNode): Extract<TypeNode, { kind: "object" }> {
  if (node.kind === "object") return node;
  if (node.kind === "type-ref") {
    const def = ctx.doc.types.get(node.name);
    if (!def) throw new Error(`Unknown type: ${node.name}`);
    return resolveObject(ctx, def.node);
  }
  if (node.kind === "intersection") return mergeObjects(ctx, node.members);
  throw new Error("Intersection operands must be object-like");
}
