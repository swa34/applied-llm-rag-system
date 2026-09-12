import { fileURLToPath } from 'node:url';
import { OpenAIProvider } from './provider.mjs';
import { loadDocuments, LocalRetriever } from './retrieval.mjs';
import { Conversation } from './chat.mjs';

export const corpusDirectory = fileURLToPath(new URL('../sample-data/fictional/', import.meta.url));

export async function createDemo() {
  const provider = new OpenAIProvider();
  const chunks = await loadDocuments(corpusDirectory);
  const retriever = await LocalRetriever.create(chunks, provider);
  return { provider, retriever, newConversation: () => new Conversation({ provider, retriever }) };
}
