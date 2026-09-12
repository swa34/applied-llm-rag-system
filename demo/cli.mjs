import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createDemo } from './setup.mjs';

function display(result, stdout, stderr) {
  stdout.write(`${result.answer}\n`);
  result.citations.forEach((source, i) => {
    stdout.write(`[${i + 1}] sample-data/fictional/${source.file}:${source.line} — ${source.section}\n`);
    source.quotes.forEach(quote => stdout.write(`    ${quote}\n`));
  });
  stderr.write(JSON.stringify({ status: result.status, resolvedQuery: result.query,
    retrievedIds: result.retrieved.map(item => item.id), timings: result.timings, usage: result.usage }, null, 2) + '\n');
}

export async function runCli({ args = process.argv.slice(2), stdin = process.stdin,
  stdout = process.stdout, stderr = process.stderr, setup = createDemo } = {}) {
  if (args.includes('--help')) {
    stdout.write('npm run demo -- "question"\nnpm run demo  (interactive: /new, /exit)\nnpm run demo:cases  (live fictional scenarios; uses paid OpenAI APIs)\n');
    return 0;
  }
  stderr.write('Fictional document demo — hosted OpenAI inference; API usage is billed.\n');
  const demo = await setup();
  stderr.write(`Index: ${JSON.stringify(demo.retriever.diagnostics)}\n`);
  let conversation = demo.newConversation();
  if (args.length) {
    display(await conversation.send(args.join(' ')), stdout, stderr);
    return 0;
  }
  const interactive = Boolean(stdin.isTTY);
  const input = createInterface({ input: stdin, output: stderr, terminal: interactive });
  let inputClosed = false;
  input.once('close', () => { inputClosed = true; });
  stderr.write('Ask about the fictional policies. /new starts a fresh conversation; /exit quits.\n');
  if (interactive) { input.setPrompt('You> '); input.prompt(); }
  let exitCode = 0;
  try {
    for await (const line of input) {
      const question = line.trim();
      if (question === '/exit') break;
      if (question === '/new') {
        conversation = demo.newConversation(); stderr.write('Started a new conversation.\n');
      } else if (question) {
        try {
          display(await conversation.send(question), stdout, stderr);
          if (interactive) exitCode = 0;
        } catch (error) { stderr.write(error.message + '\n'); exitCode = 1; }
      }
      if (interactive && !inputClosed) input.prompt();
    }
  } finally { input.close(); }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
