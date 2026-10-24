import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredModelSnapshot } from "../eval-environment.mjs";

test("model configuration snapshot resolves default and excludes secrets", () => {
  const snapshot = configuredModelSnapshot(
    { default_llm_key: "CUSTOM_LLM_example" },
    {
      custom_llms: [
        { id: "unrelated", config: { model_name: "wrong" } },
        {
          id: "example",
          config: {
            model_name: "example-model",
            provider: "openai_compatible",
            api_key: "SECRET",
            api_base: "SECRET",
            extra_parameters: { headers: "SECRET" },
          },
        },
      ],
    },
  );
  assert.equal(snapshot.model_name, "example-model");
  assert.ok(!JSON.stringify(snapshot).includes("SECRET"));
  assert.equal(snapshot.temperature, null);
});
test("an unknown default is not guessed from the first configured model", () => {
  assert.equal(
    configuredModelSnapshot({}, { custom_llms: [{ id: "other", config: {} }] })
      .status,
    "unresolved",
  );
});
