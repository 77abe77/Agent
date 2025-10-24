#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { convertTypedocToSchemas } from "./index";

async function main() {
  const arg = process.argv[2];
  let input = "";
  if (!arg || arg === "-" || arg === "/dev/stdin") {
    input = await new Response(Bun.stdin.stream()).text();
  } else {
    input = readFileSync(arg, "utf-8");
  }
  try {
    const { openai, gemini } = convertTypedocToSchemas(input);
    console.log(JSON.stringify(openai, null, 2));
    console.log("---");
    console.log(JSON.stringify(gemini, null, 2));
  } catch (e: any) {
    console.error("Error:", e?.message || String(e));
    process.exit(1);
  }
}

main();
