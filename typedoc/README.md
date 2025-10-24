TDL → JSON Schema (OpenAI + Gemini) in Bun

What this is
- A small Bun/TypeScript library and CLI that converts a TDL 1.2 typedoc (YAML) into two JSON Schemas:
  - OpenAI Structured Outputs subset
  - Gemini jsonschema_gemini subset

Status and scope
- Implements a practical subset of TDL 1.2 to keep the tool small and dependable for LLM IO.
- Supported TDL features:
  - Top-level symbols and named types
  - Inline object types, required/optional properties, arrays on labels (name[] / name?[])
  - String/number/boolean primitives; typedoc/image/audio/video mapped to string; never for closure
  - String/number/boolean literals and ALL_CAPS_TOKEN literals in enums (A | B | 'c' | 1 | true)
  - Unions (as enums when possible, otherwise anyOf)
  - Intersections of object-like types (merged structurally, rightmost wins)
  - Type references to named types
  - Extends sugar: TypeName(Base & Other): body (merged into one object)
  - String-domain index signature to never for closure: [k: string]? never
  - Ref<...> lowered as string

- Not supported (the converter will throw with a helpful error):
  - Function types
  - Conditionals (if/then/else) and infer
  - Intrinsics (Keys, TypeNames, SymbolNames, SymbolType) except as plain strings
  - Generics and alias::Qualified imports
  - String-domain maps with value types (OpenAI subset cannot express dynamic maps); Gemini supports additionalProperties but pattern-only domains are not generated.
  - Enum-like index signatures with late-bound or intrinsic domains

Key differences reflected in the outputs
- OpenAI Structured Outputs
  - The root is always an object with all symbols present in required.
  - Every object in the schema sets additionalProperties: false.
  - Optional properties are encoded as nullable, e.g. type: ["string", "null"], and still listed in required.
  - Root cannot be anyOf; nested anyOf is allowed.

- Gemini jsonschema_gemini
  - The root is also an object of symbols, but only non-optional properties are required.
  - Object openness follows TDL: open-by-default unless [k: string]? never is used; additionalProperties is set accordingly (true/false or a schema when representable).
  - $defs and $ref supported; anyOf supported.

Install and run
- With Docker (recommended):
  - docker run --rm -it -v "$PWD":/app -w /app oven/bun:1 bun install
  - docker run --rm -it -v "$PWD":/app -w /app oven/bun:1 bun run src/cli.ts examples/example.tdl.yaml

- Locally with Bun:
  - bun install
  - bun run src/cli.ts examples/example.tdl.yaml

Programmatic use
import { convertTypedocToSchemas } from "./src/index.ts";
import { readFileSync } from "node:fs";

const tdl = readFileSync("examples/example.tdl.yaml", "utf-8");
const { openai, gemini } = convertTypedocToSchemas(tdl);
console.log(JSON.stringify(openai, null, 2));
console.log(JSON.stringify(gemini, null, 2));

CLI
bun run src/cli.ts <path-or-"-" for stdin>
- Prints two JSON objects separated by a line with ---
- Example: bun run src/cli.ts examples/example.tdl.yaml

Notes on approximations
- Ref<...> is lowered to { type: "string" }.
- never is lowered to a contradictory numeric constraint for OpenAI (minimum > maximum), and as { not: {} } is not available; for Gemini it’s represented as an unsatisfiable numeric constraint as well.
- Index signatures other than [k: string]? never:
  - OpenAI: unsupported (cannot express dynamic maps in Structured Outputs); the converter throws.
  - Gemini: if [k: string]: V is used, additionalProperties is V’s schema.
  - Enum-like domains, when static and literal (e.g., [k: 'a'|'b']): materialized as explicit properties.

Example typedoc
See examples/example.tdl.yaml for a small demonstration.

License
MIT
