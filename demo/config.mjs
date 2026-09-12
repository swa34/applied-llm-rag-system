import { readFileSync } from 'node:fs';

export function validateRuntime(version = process.versions.node) {
  let pinnedVersion;
  try {
    pinnedVersion = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
  } catch {
    throw new Error('Cannot read .nvmrc. Restore the repository root runtime pin and try again.');
  }
  const expected = pinnedVersion.split('.').map(Number);
  const actual = version.split('.').map(Number);
  if (!/^\d+\.\d+\.\d+$/.test(version) || actual[0] !== expected[0] ||
    actual[1] < expected[1] || (actual[1] === expected[1] && actual[2] < expected[2])) {
    throw new Error(`Use Node.js ${pinnedVersion} from .nvmrc (supported: >=${pinnedVersion} <${expected[0] + 1}).`);
  }
}

export function readConfig(env = process.env) {
  const apiKey = env.OPENAI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OPENAI_API_KEY is required. See docs/LOCAL_DEMO.md.');
  }
  if (/\s/.test(apiKey)) throw new Error('OPENAI_API_KEY must not contain whitespace.');
  const { DEMO_MODEL: model = 'gpt-5.6-terra', DEMO_EMBED_MODEL: embeddingModel = 'text-embedding-3-small' } = env;
  for (const [name, value] of [['DEMO_MODEL', model], ['DEMO_EMBED_MODEL', embeddingModel]]) {
    if (typeof value !== 'string' || !value || /\s/.test(value)) {
      throw new Error(`${name} must be a nonempty model identifier without whitespace; unset it to use the default.`);
    }
  }
  return { apiKey, model, embeddingModel };
}
