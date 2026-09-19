/**
 * Gate script for IG-06: Gemini model identifier validation.
 * Run with: GEMINI_API_KEY=... pnpm gate:gemini
 */

import { DEFAULT_GEMINI_MODEL } from "../src/shared/constants";
import { RESOLVER_SCHEMA, RESOLVER_SYSTEM_PROMPT } from "../src/sw/gemini/prompts";
import { ResolverResponseSchema } from "../src/shared/contracts";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable is required to run IG-06.");
    console.error("Usage: GEMINI_API_KEY=<key> pnpm gate:gemini");
    process.exit(1);
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  console.log(`[IG-06] Testing Gemini model identifier: ${model}`);
  const startTime = Date.now();

  const requestBody = {
    system_instruction: {
      parts: [{ text: RESOLVER_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: "<user_command>click next</user_command>" },
          {
            text:
              "<page_elements>[{\"id\":\"el_1\",\"role\":\"button\",\"name\":\"Next\"}]</page_elements>",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESOLVER_SCHEMA,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[IG-06] FAIL: HTTP ${res.status} ${res.statusText} (${elapsed} ms)`);
      console.error(errText);
      if (res.status === 404) {
        console.error(`[IG-06] 404 Not Found indicates model '${model}' is invalid or deprecated. See HD-01.`);
      }
      process.exit(1);
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error(`[IG-06] FAIL: No candidate text in response (${elapsed} ms)`);
      process.exit(1);
    }

    const parsed = JSON.parse(text);
    const parsedValidated = ResolverResponseSchema.safeParse(parsed);

    if (!parsedValidated.success) {
      console.error(`[IG-06] FAIL: Response failed ResolverResponseSchema validation:`, parsedValidated.error);
      process.exit(1);
    }

    console.log(`[IG-06] PASS: Model '${model}' accepted, responseSchema honoured (${elapsed} ms round trip)`);
    console.log(`[IG-06] Sample output:`, JSON.stringify(parsedValidated.data));
  } catch (err) {
    console.error(`[IG-06] Error executing request:`, err);
    process.exit(1);
  }
}

main();
