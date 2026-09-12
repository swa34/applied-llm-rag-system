import { OpenAIProvider } from './provider.mjs';
import { LocalRetriever } from './retrieval.mjs';
import { datasetDirectory, loadDataset } from './dataset.mjs';
import { Conversation } from './chat.mjs';
import { validateRuntime } from './config.mjs';

export const corpusDirectory = datasetDirectory;

export async function createDemo() {
  validateRuntime();
  const provider = new OpenAIProvider();
  const { manifest, manifestSha256, chunks } = await loadDataset(corpusDirectory);
  const retriever = await LocalRetriever.create(chunks, provider);
  return { provider, retriever, dataset: { ...manifest, manifestSha256 },
    newConversation: options => new Conversation({ provider, retriever, ...options }) };
}
