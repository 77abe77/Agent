import { parseTDL, TDLDoc } from "./tdl";
import { generateOpenAISchema } from "./schema-openai";
import { generateGeminiSchema } from "./schema-gemini";

export type JSONSchema = Record<string, unknown>;

export function convertTypedocToSchemas(typedocYaml: string): { openai: JSONSchema; gemini: JSONSchema } {
  const doc: TDLDoc = parseTDL(typedocYaml);
  const openai = generateOpenAISchema(doc);
  const gemini = generateGeminiSchema(doc);
  return { openai, gemini };
}
