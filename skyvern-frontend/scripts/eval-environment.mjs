/** Record configuration provenance, never API keys, URLs, headers or arbitrary parameters. */
export function configuredModelSnapshot(identity, models) {
  const config = models.custom_llms?.find(
    (item) => `CUSTOM_LLM_${item.id}` === identity.default_llm_key,
  )?.config;
  if (!config)
    return {
      source: "configuration_api",
      status: "unresolved",
      model_name: null,
    };
  return {
    source: "configuration_api_not_per_call_telemetry",
    status: "resolved",
    model_name: config.model_name ?? null,
    provider: config.provider ?? null,
    temperature: config.temperature ?? null,
    max_completion_tokens: config.max_completion_tokens ?? null,
    reasoning_effort: config.reasoning_effort ?? null,
  };
}
