import type {
  Annotation,
  AnnotationList,
  BookmarkEntry,
  BookmarkManifest,
  Env,
  ReadingProgress,
  StoredBookmark,
} from './types';

const MANIFEST_KEY = 'bookmark/manifest.json';
const KNOWLEDGE_VERSION = 1;
const KNOWLEDGE_PREFIX = 'bookmark/knowledge/';
const KNOWLEDGE_DOC_PREFIX = `${KNOWLEDGE_PREFIX}docs/`;
const KNOWLEDGE_INDEX_KEY = `${KNOWLEDGE_PREFIX}index.json`;
const KNOWLEDGE_SEARCH_KEY = `${KNOWLEDGE_PREFIX}search.json`;
const SEARCH_INDEX_CACHE_TTL_MS = 30_000;

type KnowledgeField = 'title' | 'annotations' | 'description' | 'url' | 'body';
type TokenCounts = Record<string, number>;

const FIELD_WEIGHTS: Record<KnowledgeField, number> = {
  title: 20,
  annotations: 14,
  description: 8,
  url: 4,
  body: 2,
};

const PHRASE_BOOSTS: Record<KnowledgeField, number> = {
  title: 40,
  annotations: 28,
  description: 16,
  url: 8,
  body: 6,
};

export interface KnowledgeIndexFailure {
  key: string;
  title?: string;
  reason: string;
}

export interface KnowledgeIndexMetadata {
  version: number;
  builtAt: string;
  bookmarkCount: number;
  indexedCount: number;
  failures: KnowledgeIndexFailure[];
}

interface KnowledgeDocumentAnnotation {
  id: string;
  selectedText: string;
  note: string;
  createdAt: string;
}

interface KnowledgeDocument {
  version: number;
  bookmarkKey: string;
  title: string;
  description: string;
  url: string;
  sourceUrl: string;
  scrapedAt: string;
  indexedAt: string;
  annotationCount: number;
  annotations: KnowledgeDocumentAnnotation[];
  fields: Record<KnowledgeField, string>;
  tokenCounts: Record<KnowledgeField, TokenCounts>;
}

interface KnowledgeSearchIndex {
  version: number;
  builtAt: string;
  documents: KnowledgeDocument[];
}

interface ScoredDocument {
  document: KnowledgeDocument;
  score: number;
  matchedFields: KnowledgeField[];
  fieldScores: Record<KnowledgeField, number>;
  progress: ReadingProgress | null;
}

interface KnowledgeSearchParams {
  query: string;
  state: string;
  favourite?: boolean;
  annotated?: boolean;
  limit: number;
}

interface AnnotationSearchCandidate {
  annotation: KnowledgeDocumentAnnotation;
  document: KnowledgeDocument;
  score: number;
  progress: ReadingProgress | null;
}

interface RefreshKnowledgeDocumentOptions {
  updateSearchIndex?: boolean;
}

let knowledgeSearchIndexCache: {
  cachedAt: number;
  index: KnowledgeSearchIndex;
} | null = null;

export async function getKnowledgeIndexStatus(env: Env): Promise<{
  status: 'missing' | 'ready';
  index: KnowledgeIndexMetadata | null;
}> {
  const object = await env.BOOKMARK_BUCKET.get(KNOWLEDGE_INDEX_KEY);
  if (!object) {
    return { status: 'missing', index: null };
  }

  return {
    status: 'ready',
    index: await object.json() as KnowledgeIndexMetadata,
  };
}

export async function rebuildKnowledgeIndex(env: Env): Promise<KnowledgeIndexMetadata | null> {
  const manifest = await getManifest(env);
  if (!manifest) {
    return null;
  }

  const builtAt = new Date().toISOString();
  const failures: KnowledgeIndexFailure[] = [];
  const expectedDocumentKeys = new Set<string>();
  const documents: KnowledgeDocument[] = [];
  let indexedCount = 0;

  for (const bookmark of manifest.bookmarks) {
    try {
      const object = await env.BOOKMARK_BUCKET.get(getStoredBookmarkKey(bookmark.key));
      if (!object) {
        throw new Error('Stored bookmark JSON not found');
      }

      const storedBookmark = await object.json() as StoredBookmark;
      const document = await refreshKnowledgeDocument(env, bookmark, storedBookmark, builtAt, {
        updateSearchIndex: false,
      });
      expectedDocumentKeys.add(getKnowledgeDocumentKey(bookmark.key));
      documents.push(document);
      indexedCount += 1;
    } catch (error) {
      failures.push({
        key: bookmark.key,
        title: bookmark.title,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await deleteStaleKnowledgeDocuments(env, expectedDocumentKeys);
  await writeKnowledgeSearchIndex(env, builtAt, documents);

  const metadata: KnowledgeIndexMetadata = {
    version: KNOWLEDGE_VERSION,
    builtAt,
    bookmarkCount: manifest.bookmarks.length,
    indexedCount,
    failures,
  };

  await env.BOOKMARK_BUCKET.put(KNOWLEDGE_INDEX_KEY, JSON.stringify(metadata), {
    httpMetadata: { contentType: 'application/json' },
  });

  return metadata;
}

export async function refreshKnowledgeDocument(
  env: Env,
  bookmark: BookmarkEntry,
  storedBookmark: StoredBookmark,
  indexedAt = new Date().toISOString(),
  options: RefreshKnowledgeDocumentOptions = {},
): Promise<KnowledgeDocument> {
  const annotationList = await getAnnotationList(env, bookmark.key);
  const document = buildKnowledgeDocument(bookmark, storedBookmark, annotationList.annotations, indexedAt);

  await env.BOOKMARK_BUCKET.put(getKnowledgeDocumentKey(bookmark.key), JSON.stringify(document), {
    httpMetadata: { contentType: 'application/json' },
  });

  if (options.updateSearchIndex !== false) {
    await upsertKnowledgeSearchIndexDocument(env, document);
  }

  return document;
}

export async function refreshKnowledgeDocumentForKey(env: Env, key: string): Promise<boolean> {
  const manifest = await getManifest(env);
  const bookmark = manifest?.bookmarks.find(item => item.key === key);
  if (!bookmark) {
    return false;
  }

  const object = await env.BOOKMARK_BUCKET.get(getStoredBookmarkKey(key));
  if (!object) {
    await deleteKnowledgeDocumentForKey(env, key);
    return false;
  }

  const storedBookmark = await object.json() as StoredBookmark;
  await refreshKnowledgeDocument(env, bookmark, storedBookmark);
  return true;
}

export async function deleteKnowledgeDocumentForKey(env: Env, key: string): Promise<void> {
  await env.BOOKMARK_BUCKET.delete(getKnowledgeDocumentKey(key));
  await removeKnowledgeSearchIndexDocument(env, key);
}

export async function searchKnowledgeDocuments(env: Env, searchParams: URLSearchParams) {
  const params = parseKnowledgeSearchParams(searchParams);
  const queryTokens = uniqueTokens(tokenize(params.query));
  const normalizedQuery = normalizeForSearch(params.query);
  const documents = await listKnowledgeDocuments(env);
  let scoredDocuments: ScoredDocument[] = documents
    .map(document => ({
      ...scoreDocument(document, queryTokens, normalizedQuery),
      document,
      progress: null,
    }))
    .filter(item => matchesStaticDocumentFilters(item, params))
    .filter(item => queryTokens.length === 0 || item.score > 0);

  if (filterRequiresProgress(params)) {
    scoredDocuments = await withReadingProgress(env, scoredDocuments);
    scoredDocuments = scoredDocuments.filter(item => matchesProgressFilters(item, params));
  }

  const results = scoredDocuments
    .sort(compareScoredDocuments)
    .slice(0, params.limit);
  const resultsWithProgress = filterRequiresProgress(params)
    ? results
    : await withReadingProgress(env, results);

  const formattedResults = resultsWithProgress
    .map(item => formatSearchResult(item, queryTokens));

  return {
    query: params.query,
    filters: {
      state: params.state,
      favourite: params.favourite ?? null,
      annotated: params.annotated ?? null,
      limit: params.limit,
    },
    count: formattedResults.length,
    results: formattedResults,
  };
}

export async function searchKnowledgeAnnotations(env: Env, searchParams: URLSearchParams) {
  const query = normalizeWhitespace(searchParams.get('q') || '');
  const limit = parseLimit(searchParams.get('limit'));
  const queryTokens = uniqueTokens(tokenize(query));
  const normalizedQuery = normalizeForSearch(query);
  const documents = await listKnowledgeDocuments(env);
  const candidates: AnnotationSearchCandidate[] = [];

  for (const document of documents) {
    if (document.annotations.length === 0) continue;

    for (const annotation of document.annotations) {
      const score = scoreAnnotation(document, annotation, queryTokens, normalizedQuery);
      if (queryTokens.length > 0 && score <= 0) continue;
      candidates.push({ annotation, document, score, progress: null });
    }
  }

  const selectedCandidates = candidates
    .sort(compareAnnotationCandidates)
    .slice(0, limit);
  const annotations = (await withAnnotationReadingProgress(env, selectedCandidates))
    .map(candidate => formatAnnotationResult(candidate, queryTokens));

  return {
    query,
    count: annotations.length,
    annotations,
  };
}

function buildKnowledgeDocument(
  bookmark: BookmarkEntry,
  storedBookmark: StoredBookmark,
  annotations: Annotation[],
  indexedAt: string,
): KnowledgeDocument {
  const metadata = storedBookmark.firecrawlResponse?.data?.metadata || {};
  const title = normalizeWhitespace(bookmark.title || metadata.title || storedBookmark.url);
  const description = normalizeWhitespace(bookmark.description || metadata.description || '');
  const url = normalizeWhitespace(bookmark.url || storedBookmark.url || '');
  const sourceUrl = normalizeWhitespace(
    typeof metadata.sourceURL === 'string' ? metadata.sourceURL : storedBookmark.url || url,
  );
  const body = extractBookmarkBodyText(storedBookmark);
  const documentAnnotations = annotations.map(annotation => ({
    id: annotation.id,
    selectedText: normalizeWhitespace(annotation.selectedText),
    note: normalizeWhitespace(annotation.note),
    createdAt: annotation.createdAt,
  }));
  const annotationText = normalizeWhitespace(
    documentAnnotations
      .map(annotation => [annotation.selectedText, annotation.note].filter(Boolean).join(' '))
      .join(' '),
  );

  const fields: Record<KnowledgeField, string> = {
    title,
    annotations: annotationText,
    description,
    url: `${url} ${sourceUrl}`.trim(),
    body,
  };

  return {
    version: KNOWLEDGE_VERSION,
    bookmarkKey: bookmark.key,
    title,
    description,
    url,
    sourceUrl,
    scrapedAt: storedBookmark.scrapedAt,
    indexedAt,
    annotationCount: documentAnnotations.length,
    annotations: documentAnnotations,
    fields,
    tokenCounts: {
      title: countTokens(fields.title),
      annotations: countTokens(fields.annotations),
      description: countTokens(fields.description),
      url: countTokens(fields.url),
      body: countTokens(fields.body),
    },
  };
}

function scoreDocument(
  document: KnowledgeDocument,
  queryTokens: string[],
  normalizedQuery: string,
): Omit<ScoredDocument, 'document' | 'progress'> {
  const fieldScores = emptyFieldScores();
  if (queryTokens.length === 0) {
    return { score: 0, matchedFields: [], fieldScores };
  }

  for (const field of Object.keys(FIELD_WEIGHTS) as KnowledgeField[]) {
    const counts = document.tokenCounts[field] || {};
    for (const token of queryTokens) {
      fieldScores[field] += Math.min(counts[token] || 0, 10) * FIELD_WEIGHTS[field];
    }

    if (normalizedQuery && normalizeForSearch(document.fields[field]).includes(normalizedQuery)) {
      fieldScores[field] += PHRASE_BOOSTS[field];
    }
  }

  const matchedFields = (Object.keys(fieldScores) as KnowledgeField[])
    .filter(field => fieldScores[field] > 0);

  return {
    score: matchedFields.reduce((sum, field) => sum + fieldScores[field], 0),
    matchedFields,
    fieldScores,
  };
}

function scoreAnnotation(
  document: KnowledgeDocument,
  annotation: KnowledgeDocumentAnnotation,
  queryTokens: string[],
  normalizedQuery: string,
): number {
  if (queryTokens.length === 0) return 0;

  const annotationText = `${annotation.selectedText} ${annotation.note}`.trim();
  const counts = countTokens(annotationText);
  let score = 0;

  for (const token of queryTokens) {
    score += Math.min(counts[token] || 0, 10) * FIELD_WEIGHTS.annotations;
    score += Math.min(document.tokenCounts.title[token] || 0, 10) * 4;
  }

  if (normalizedQuery && normalizeForSearch(annotationText).includes(normalizedQuery)) {
    score += PHRASE_BOOSTS.annotations;
  }

  return score;
}

function matchesStaticDocumentFilters(item: ScoredDocument, params: KnowledgeSearchParams): boolean {
  const hasAnnotations = item.document.annotationCount > 0;

  if (params.state === 'annotated' && !hasAnnotations) return false;
  if (params.annotated !== undefined && hasAnnotations !== params.annotated) return false;

  return true;
}

function matchesProgressFilters(item: ScoredDocument, params: KnowledgeSearchParams): boolean {
  const isRead = item.progress?.isRead === true;
  const isFavourite = item.progress?.isFavourite === true;

  if (params.state === 'read' && !isRead) return false;
  if (params.state === 'unread' && isRead) return false;
  if (params.state === 'favourites' && !isFavourite) return false;
  if (params.favourite !== undefined && isFavourite !== params.favourite) return false;

  return true;
}

function filterRequiresProgress(params: KnowledgeSearchParams): boolean {
  return params.state === 'read'
    || params.state === 'unread'
    || params.state === 'favourites'
    || params.favourite !== undefined;
}

async function withReadingProgress(env: Env, items: ScoredDocument[]): Promise<ScoredDocument[]> {
  return Promise.all(items.map(async item => ({
    ...item,
    progress: await getReadingProgress(env, item.document.bookmarkKey),
  })));
}

async function withAnnotationReadingProgress(
  env: Env,
  candidates: AnnotationSearchCandidate[],
): Promise<AnnotationSearchCandidate[]> {
  const uniqueKeys = Array.from(new Set(candidates.map(candidate => candidate.document.bookmarkKey)));
  const progressEntries = await Promise.all(
    uniqueKeys.map(async key => [key, await getReadingProgress(env, key)] as const),
  );
  const progressByKey = new Map(progressEntries);

  return candidates.map(candidate => ({
    ...candidate,
    progress: progressByKey.get(candidate.document.bookmarkKey) ?? null,
  }));
}

function formatSearchResult(item: ScoredDocument, queryTokens: string[]) {
  const document = item.document;
  const progress = item.progress;
  return {
    key: document.bookmarkKey,
    title: document.title,
    description: document.description,
    url: document.url,
    sourceUrl: document.sourceUrl,
    readUrl: `/read/${encodeURIComponent(document.bookmarkKey)}`,
    score: item.score,
    matchedFields: item.matchedFields,
    snippet: buildSnippet(document, item.fieldScores, queryTokens),
    progress,
    isRead: progress?.isRead === true,
    isFavourite: progress?.isFavourite === true,
    hasAnnotations: document.annotationCount > 0,
    annotationCount: document.annotationCount,
    indexedAt: document.indexedAt,
  };
}

function formatAnnotationResult(candidate: AnnotationSearchCandidate, queryTokens: string[]) {
  const { annotation, document, progress } = candidate;
  const text = [annotation.selectedText, annotation.note].filter(Boolean).join(' ');

  return {
    id: annotation.id,
    bookmarkKey: document.bookmarkKey,
    title: document.title,
    url: document.url,
    sourceUrl: document.sourceUrl,
    readUrl: `/read/${encodeURIComponent(document.bookmarkKey)}`,
    selectedText: annotation.selectedText,
    note: annotation.note,
    createdAt: annotation.createdAt,
    score: candidate.score,
    snippet: buildHighlightedSnippet(text || document.title, queryTokens),
    isRead: progress?.isRead === true,
    isFavourite: progress?.isFavourite === true,
  };
}

function buildSnippet(
  document: KnowledgeDocument,
  fieldScores: Record<KnowledgeField, number>,
  queryTokens: string[],
) {
  const fieldOrder = (Object.keys(fieldScores) as KnowledgeField[])
    .sort((a, b) => fieldScores[b] - fieldScores[a]);
  const matchedField = fieldOrder.find(field => fieldScores[field] > 0 && document.fields[field]);
  const fallbackField = document.description
    ? 'description'
    : document.fields.annotations
      ? 'annotations'
      : 'body';
  const field = matchedField || fallbackField;
  const sourceText = document.fields[field] || document.title;

  return {
    field,
    text: buildSnippetText(sourceText, queryTokens),
    html: buildHighlightedSnippet(sourceText, queryTokens),
  };
}

function buildHighlightedSnippet(text: string, queryTokens: string[]) {
  return highlightMatches(buildSnippetText(text, queryTokens), queryTokens);
}

function buildSnippetText(text: string, queryTokens: string[]): string {
  const normalizedText = normalizeWhitespace(text);
  if (normalizedText.length <= 240) return normalizedText;

  let index = -1;
  const lowerText = normalizedText.toLowerCase();
  for (const token of queryTokens) {
    const tokenIndex = lowerText.indexOf(token.toLowerCase());
    if (tokenIndex >= 0 && (index < 0 || tokenIndex < index)) {
      index = tokenIndex;
    }
  }

  if (index < 0) {
    return `${normalizedText.slice(0, 237).trim()}...`;
  }

  const start = Math.max(0, index - 90);
  const end = Math.min(normalizedText.length, index + 150);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';

  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`;
}

function highlightMatches(text: string, queryTokens: string[]): string {
  if (queryTokens.length === 0) return escapeHtml(text);

  const tokens = uniqueTokens(queryTokens)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (tokens.length === 0) return escapeHtml(text);

  const pattern = new RegExp(`(${tokens.join('|')})`, 'gi');
  let html = '';
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index || 0;
    html += escapeHtml(text.slice(lastIndex, index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    lastIndex = index + match[0].length;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function compareScoredDocuments(a: ScoredDocument, b: ScoredDocument): number {
  if (b.score !== a.score) return b.score - a.score;
  const titleCompare = a.document.title.localeCompare(b.document.title);
  if (titleCompare !== 0) return titleCompare;
  return a.document.bookmarkKey.localeCompare(b.document.bookmarkKey);
}

function compareAnnotationCandidates(a: AnnotationSearchCandidate, b: AnnotationSearchCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  return b.annotation.createdAt.localeCompare(a.annotation.createdAt);
}

async function listKnowledgeDocuments(env: Env): Promise<KnowledgeDocument[]> {
  const searchIndex = await readKnowledgeSearchIndex(env);
  if (searchIndex) {
    return searchIndex.documents;
  }

  const documents = await listKnowledgeDocumentsFromPerDocumentStorage(env);
  if (documents.length > 0) {
    await writeKnowledgeSearchIndex(env, new Date().toISOString(), documents).catch(() => undefined);
  }
  return documents;
}

async function readKnowledgeSearchIndex(env: Env): Promise<KnowledgeSearchIndex | null> {
  if (
    knowledgeSearchIndexCache
    && Date.now() - knowledgeSearchIndexCache.cachedAt < SEARCH_INDEX_CACHE_TTL_MS
  ) {
    return knowledgeSearchIndexCache.index;
  }

  const object = await env.BOOKMARK_BUCKET.get(KNOWLEDGE_SEARCH_KEY);
  if (!object) {
    return null;
  }

  try {
    const index = await object.json() as KnowledgeSearchIndex;
    if (index.version !== KNOWLEDGE_VERSION || !Array.isArray(index.documents)) {
      return null;
    }
    knowledgeSearchIndexCache = { cachedAt: Date.now(), index };
    return index;
  } catch {
    return null;
  }
}

async function writeKnowledgeSearchIndex(
  env: Env,
  builtAt: string,
  documents: KnowledgeDocument[],
): Promise<void> {
  const index: KnowledgeSearchIndex = {
    version: KNOWLEDGE_VERSION,
    builtAt,
    documents: sortKnowledgeDocuments(documents),
  };

  await env.BOOKMARK_BUCKET.put(KNOWLEDGE_SEARCH_KEY, JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  });
  knowledgeSearchIndexCache = { cachedAt: Date.now(), index };
}

async function upsertKnowledgeSearchIndexDocument(env: Env, document: KnowledgeDocument): Promise<void> {
  const existingIndex = await readKnowledgeSearchIndex(env);
  const documents = existingIndex
    ? existingIndex.documents
    : await listKnowledgeDocumentsFromPerDocumentStorage(env);
  const nextDocuments = documents
    .filter(item => item.bookmarkKey !== document.bookmarkKey);
  nextDocuments.push(document);

  await writeKnowledgeSearchIndex(env, document.indexedAt, nextDocuments);
}

async function removeKnowledgeSearchIndexDocument(env: Env, key: string): Promise<void> {
  const existingIndex = await readKnowledgeSearchIndex(env);
  if (!existingIndex) {
    return;
  }

  await writeKnowledgeSearchIndex(
    env,
    existingIndex.builtAt,
    existingIndex.documents.filter(document => document.bookmarkKey !== key),
  );
}

function sortKnowledgeDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort((a, b) => a.bookmarkKey.localeCompare(b.bookmarkKey));
}

async function listKnowledgeDocumentsFromPerDocumentStorage(env: Env): Promise<KnowledgeDocument[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const listing = await env.BOOKMARK_BUCKET.list({ prefix: KNOWLEDGE_DOC_PREFIX, cursor });
    keys.push(...listing.objects.map(object => object.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  const documents = await Promise.all(keys.map(async key => {
    try {
      const object = await env.BOOKMARK_BUCKET.get(key);
      if (!object) return null;
      const document = await object.json() as KnowledgeDocument;
      return document.version === KNOWLEDGE_VERSION ? document : null;
    } catch {
      return null;
    }
  }));

  return documents.filter((document): document is KnowledgeDocument => document !== null);
}

async function deleteStaleKnowledgeDocuments(env: Env, expectedDocumentKeys: Set<string>): Promise<void> {
  let cursor: string | undefined;

  do {
    const listing = await env.BOOKMARK_BUCKET.list({ prefix: KNOWLEDGE_DOC_PREFIX, cursor });
    await Promise.all(
      listing.objects
        .filter(object => !expectedDocumentKeys.has(object.key))
        .map(object => env.BOOKMARK_BUCKET.delete(object.key))
    );
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

async function getManifest(env: Env): Promise<BookmarkManifest | null> {
  const object = await env.BOOKMARK_BUCKET.get(MANIFEST_KEY);
  if (!object) return null;
  return object.json() as Promise<BookmarkManifest>;
}

async function getAnnotationList(env: Env, bookmarkKey: string): Promise<AnnotationList> {
  const value = await env.NIKK_BOOKMARK_ANNOTATION.get(bookmarkKey);
  if (!value) return { annotations: [] };
  return JSON.parse(value) as AnnotationList;
}

async function getReadingProgress(env: Env, bookmarkKey: string): Promise<ReadingProgress | null> {
  const value = await env.NIKK_BOOKMARK_PROGRESS.get(bookmarkKey);
  return value ? JSON.parse(value) as ReadingProgress : null;
}

function parseKnowledgeSearchParams(searchParams: URLSearchParams): KnowledgeSearchParams {
  const rawState = searchParams.get('state') || 'all';
  const state = normalizeFilterState(rawState);

  return {
    query: normalizeWhitespace(searchParams.get('q') || ''),
    state,
    favourite: parseOptionalBoolean(searchParams.get('favourite') ?? searchParams.get('favorite')),
    annotated: parseOptionalBoolean(searchParams.get('annotated')),
    limit: parseLimit(searchParams.get('limit')),
  };
}

function normalizeFilterState(value: string): string {
  if (value === 'read' || value === 'unread' || value === 'annotated') return value;
  if (value === 'favourite' || value === 'favourites' || value === 'favorite' || value === 'favorites') {
    return 'favourites';
  }
  return 'all';
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null || value === '') return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

function extractBookmarkBodyText(bookmark: StoredBookmark): string {
  const data = bookmark.firecrawlResponse?.data || {};
  if (data.markdown) {
    return markdownToText(data.markdown);
  }
  if (data.html) {
    return htmlToText(data.html);
  }
  if (data.rawHtml) {
    return htmlToText(data.rawHtml);
  }
  return '';
}

function markdownToText(value: string): string {
  return normalizeWhitespace(
    htmlToText(value)
      .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-z0-9_-]*|```/gi, ' '))
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 $2')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[\s-]*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_~>#|]/g, ' ')
  );
}

function htmlToText(value: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function countTokens(value: string): TokenCounts {
  return tokenize(value).reduce<TokenCounts>((counts, token) => {
    counts[token] = (counts[token] || 0) + 1;
    return counts;
  }, {});
}

function tokenize(value: string): string[] {
  return normalizeForSearch(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens));
}

function normalizeForSearch(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function emptyFieldScores(): Record<KnowledgeField, number> {
  return {
    title: 0,
    annotations: 0,
    description: 0,
    url: 0,
    body: 0,
  };
}

function getStoredBookmarkKey(key: string): string {
  return `bookmark/${key}.json`;
}

function getKnowledgeDocumentKey(key: string): string {
  return `${KNOWLEDGE_DOC_PREFIX}${encodeURIComponent(key)}.json`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([a-f0-9]+);/gi, (_, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
