import { validateRuntime, readConfig } from './config.mjs';
import { loadEvaluationData } from './dataset.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--config')) {
    throw new Error('Usage: npm run check | npm run demo:check');
  }
  validateRuntime();
  if (args[0] === '--config') readConfig();
  const { dataset, development, heldout } = await loadEvaluationData();
  console.log(`Runtime and fictional dataset OK: ${dataset.chunks.length} passages, ` +
    `${development.cases.length} development cases, ${heldout.cases.length} held-out cases.`);
  if (args[0] === '--config') console.log('Configuration syntax OK; credentials and model access were not checked with the provider.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
