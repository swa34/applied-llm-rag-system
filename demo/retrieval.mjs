import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export async function loadDocuments(directory) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map(entry => entry.name).sort();
  const chunks = [];
  for (const file of files) {
    const markdown = (await readFile(join(directory, file), 'utf8')).replaceAll('\r\n', '\n');
    let title = file, section = file, body = [], startLine = 1;
    const flush = () => {
      const text = body.join('\n').trim();
      if (!text) return;
      const hash = createHash('sha256').update(`${section}\n${startLine}\n${text}`).digest('hex').slice(0, 12);
      const firstTextLine = startLine + body.findIndex(line => line.trim());
      chunks.push({ id: `${file}#${hash}`, file, title, section, line: firstTextLine, text });
    };
    for (const [i, line] of markdown.split('\n').entries()) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flush(); body = []; startLine = i + 2;
        section = heading[2];
        if (heading[1] === '#') title = section;
      } else {
        // Bound passages while preserving the exact source text for citation checks.
        if (body.join('\n').length + line.length > 1800) {
          flush(); body = []; startLine = i + 1;
        }
        if (line.length > 1800) throw new Error(`Line too long in ${file}; split the Markdown paragraph.`);
        body.push(line);
      }
    }
    flush();
  }
  if (!chunks.length) throw new Error('No Markdown evidence found.');
  return chunks;
}

function checkVector(vector, dimensions) {
  if (!Array.isArray(vector) || !vector.length || vector.length !== dimensions ||
    vector.some(value => !Number.isFinite(value)) || Math.hypot(...vector) === 0) {
    throw new Error('Invalid embedding vector or incompatible dimensions.');
  }
}

export function cosine(a, b) {
  checkVector(a, b?.length);
  checkVector(b, a.length);
  return a.reduce((sum, value, i) => sum + value * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
}

const stopwords = new Set('a an and are as at be by do does for from how i in is it of on or that the this to was what when where which who with'.split(' '));
const terms = text => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(term => !stopwords.has(term)));

export class LocalRetriever {
  static async create(chunks, embedder) {
    const start = performance.now();
    const embedding = await embedder.embed(chunks.map(chunk => `${chunk.title}\n${chunk.section}\n${chunk.text}`));
    if (embedding.vectors.length !== chunks.length) throw new Error('Embedding count does not match corpus.');
    for (const vector of embedding.vectors) checkVector(vector, embedding.vectors[0]?.length);
    return new LocalRetriever(chunks, embedding.vectors, embedder, {
      chunks: chunks.length, embeddingMs: performance.now() - start,
      usage: embedding.usage, model: embedding.model,
    });
  }

  constructor(chunks, vectors, embedder, diagnostics) {
    this.chunks = chunks;
    this.vectors = vectors;
    this.embedder = embedder;
    this.diagnostics = diagnostics;
  }

  async retrieve(query, topK = 6) {
    const embedding = await this.embedder.embed([query]);
    const queryTerms = terms(query);
    const candidates = this.chunks.map((chunk, i) => {
      const documentTerms = terms(`${chunk.title} ${chunk.section} ${chunk.text}`);
      const keywordScore = [...queryTerms].filter(term => documentTerms.has(term)).length;
      return { ...chunk, semanticScore: cosine(this.vectors[i], embedding.vectors[0]), keywordScore };
    });
    const dense = [...candidates].sort((a, b) => b.semanticScore - a.semanticScore || a.id.localeCompare(b.id));
    const lexical = candidates.filter(item => item.keywordScore > 0)
      .sort((a, b) => b.keywordScore - a.keywordScore || a.id.localeCompare(b.id));
    const ranks = new Map(dense.map((item, i) => [item.id, 1 / (60 + i + 1)]));
    lexical.forEach((item, i) => ranks.set(item.id, ranks.get(item.id) + 1 / (60 + i + 1)));
    const matches = candidates.map(item => ({ ...item, score: ranks.get(item.id) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK);
    return { matches, usage: embedding.usage, model: embedding.model };
  }
}
