import { createInterface } from 'node:readline';
import { createDemo } from './setup.mjs';

function display(result) {
  console.log(`\n${result.answer}`);
  result.citations.forEach((source, i) => {
    console.log(`[${i + 1}] sample-data/fictional/${source.file}:${source.line} — ${source.section}\n    ${source.quote}`);
  });
  console.log(JSON.stringify({ status: result.status, resolvedQuery: result.query,
    retrievedIds: result.retrieved.map(item => item.id), timings: result.timings, usage: result.usage }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('npm run demo -- "question"\nnpm run demo  (interactive: /new, /exit)\nnpm run demo:cases  (live fictional scenarios; uses paid OpenAI APIs)');
    return;
  }
  console.log('Fictional document demo — hosted OpenAI inference; API usage is billed.');
  const demo = await createDemo();
  console.log('Index:', JSON.stringify(demo.retriever.diagnostics));
  let conversation = demo.newConversation();
  if (args.length) {
    display(await conversation.send(args.join(' ')));
    return;
  }
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  console.log('Ask about the fictional policies. /new starts a fresh conversation; /exit quits.');
  if (process.stdin.isTTY) input.setPrompt('You> ');
  if (process.stdin.isTTY) input.prompt();
  try {
    for await (const line of input) {
      const question = line.trim();
      if (question === '/exit') break;
      if (question === '/new') {
        conversation = demo.newConversation(); console.log('Started a new conversation.');
      } else if (question) {
        try { display(await conversation.send(question)); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
      }
      if (process.stdin.isTTY) input.prompt();
    }
  } finally { input.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
