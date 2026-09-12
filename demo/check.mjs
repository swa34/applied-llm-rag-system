import { validateRuntime, readConfig } from './config.mjs';
import { loadDocuments } from './retrieval.mjs';
import { corpusDirectory } from './setup.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--config')) {
    throw new Error('Usage: npm run check | npm run demo:check');
  }
  validateRuntime();
  if (args[0] === '--config') readConfig();
  const chunks = await loadDocuments(corpusDirectory);
  console.log(`Runtime and fictional corpus OK: ${chunks.length} passages.`);
  if (args[0] === '--config') console.log('Configuration syntax OK; credentials and model access were not checked with the provider.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
