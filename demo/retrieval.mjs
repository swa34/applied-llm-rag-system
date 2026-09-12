import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export async function loadDocuments(directory, options = {}) {
  const { files: allowedFiles, passageIds } = options;
  const files = allowedFiles ? [...allowedFiles].sort() : (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map(entry => entry.name).sort();
  const chunks = [];
  for (const file of files) {
    const markdown = (await readFile(join(directory, file), 'utf8')).replaceAll('\r\n', '\n');
    let title = file, section = file, body = [], bodyLength = 0, startLine = 1, startColumn = 0;
    const flush = () => {
      const text = body.join('\n').trim();
      if (!text) return;
      const position = `${startLine}${startColumn ? `:${startColumn}` : ''}`;
      const hash = createHash('sha256').update(`${section}\n${position}\n${text}`).digest('hex').slice(0, 12);
      const firstTextLine = startLine + body.findIndex(line => line.trim());
      const declaredId = passageIds?.get(`${file}\0${section}`);
      if (passageIds && !declaredId) throw new Error(`Undeclared evidence section: ${file} — ${section}.`);
      chunks.push({ id: declaredId ?? `${file}#${hash}`, file, title, section, line: firstTextLine, text });
    };
    for (const [i, line] of markdown.split('\n').entries()) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flush(); body = []; bodyLength = 0; startLine = i + 2; startColumn = 0;
        section = heading[2];
        if (heading[1] === '#') title = section;
      } else {
        // Bound passages while preserving the exact source text for citation checks.
        if (bodyLength + (body.length ? 1 : 0) + line.length > 1800) {
          flush(); body = []; bodyLength = 0; startLine = i + 1; startColumn = 0;
        }
        if (line.length > 1800) {
          let offset = 0;
          while (offset < line.length) {
            const remaining = line.slice(offset);
            let end = Math.min(1800, remaining.length);
            if (end < remaining.length) {
              // Prefer word boundaries, with a hard split for an oversized token.
              const whitespace = remaining.slice(0, end + 1).search(/\s\S*$/);
              if (whitespace > 0) end = whitespace;
              if (/[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end])) end--;
            }
            body = [remaining.slice(0, end)]; startLine = i + 1; startColumn = offset;
            flush(); offset += end;
          }
          body = []; bodyLength = 0; startLine = i + 2; startColumn = 0;
          continue;
        }
        bodyLength += (body.length ? 1 : 0) + line.length;
        body.push(line);
      }
    }
    flush();
  }
  if (!chunks.length) throw new Error('No Markdown evidence found.');
  return chunks;
}

function normalizeVector(vector, dimensions) {
  if (!Array.isArray(vector) || !vector.length || vector.length !== dimensions) {
    throw new Error('Invalid embedding vector or incompatible dimensions.');
  }
  let scale = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('Invalid embedding vector or incompatible dimensions.');
    scale = Math.max(scale, Math.abs(value));
  }
  if (!scale) throw new Error('Invalid embedding vector or incompatible dimensions.');
  // Scaling avoids overflow/underflow; iteration avoids a function argument limit.
  const scaled = vector.map(value => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  return scaled.map(value => value / norm);
}

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function cosine(a, b) {
  return dot(normalizeVector(a, b?.length), normalizeVector(b, a.length));
}

const stopwords = new Set('a an and are as at be by do does for from how i in is it of on or that the this to was what when where which who with'.split(' '));
const terms = text => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(term => !stopwords.has(term)));

export class LocalRetriever {
  static async create(chunks, embedder) {
    const start = performance.now();
    const embedding = await embedder.embed(chunks.map(chunk => `${chunk.title}\n${chunk.section}\n${chunk.text}`));
    if (embedding.vectors.length !== chunks.length) throw new Error('Embedding count does not match corpus.');
    return new LocalRetriever(chunks, embedding.vectors, embedder, {
      chunks: chunks.length, embeddingMs: performance.now() - start,
      usage: embedding.usage, model: embedding.model,
    });
  }

  constructor(chunks, vectors, embedder, diagnostics) {
    this.chunks = chunks;
    this.vectors = vectors.map(vector => normalizeVector(vector, vectors[0]?.length));
    this.documentTerms = chunks.map(chunk => terms(`${chunk.title} ${chunk.section} ${chunk.text}`));
    this.embedder = embedder;
    this.diagnostics = diagnostics;
  }

  async retrieve(query, topK = 6) {
    const embedding = await this.embedder.embed([query]);
    if (embedding.vectors.length !== 1) throw new Error('Embedding count does not match query.');
    const queryVector = normalizeVector(embedding.vectors[0], this.vectors[0]?.length);
    const queryTerms = terms(query);
    const candidates = this.chunks.map((chunk, i) => {
      let keywordScore = 0;
      for (const term of queryTerms) if (this.documentTerms[i].has(term)) keywordScore++;
      return { ...chunk, semanticScore: dot(this.vectors[i], queryVector), keywordScore };
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
