"""Register Bailian from local secrets and select it as this installation's default."""
from local_smoke import ROOT, request


def main() -> None:
    """Keep the named local model configuration idempotent across restarts."""
    env = dict(line.split('=', 1) for line in (ROOT / '.env.bailian').read_text().splitlines()
               if line.strip() and not line.startswith('#') and '=' in line)
    config = {
        'display_name': 'Bailian Qwen 3.5 Plus', 'provider': 'openai_compatible',
        'model_name': env['OPENAI_COMPATIBLE_MODEL_NAME'],
        'api_base': env['OPENAI_COMPATIBLE_API_BASE'],
        'api_key': env['OPENAI_COMPATIBLE_API_KEY'],
        'supports_vision': True, 'max_completion_tokens': 8192, 'temperature': 0,
        'extra_parameters': {'extra_body': {'enable_thinking': False}},
    }
    existing = request('/custom-llms')['custom_llms']
    model = next((item for item in existing
                  if item['config']['display_name'] == config['display_name']), None)
    if model:
        result = request('/custom-llms/' + model['id'], {'config': config}, method='PUT')
    else:
        result = request('/custom-llms', {'config': config})
    model_key = 'CUSTOM_LLM_' + result['custom_llm']['id']
    request('/organizations', {
        'default_llm_key': model_key, 'default_secondary_llm_key': model_key,
    }, method='PUT', base='http://127.0.0.1:8000/api/v1')
    print('Configured default model:', config['display_name'], '(thinking disabled)')


if __name__ == '__main__':
    main()
