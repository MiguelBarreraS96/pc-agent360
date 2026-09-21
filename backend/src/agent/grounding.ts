import type { RagEvidenceItem } from "../rag/discovery-engine.gateway";

import type { FactTopic, VerifiedFact } from "./agent.models";
import { normalizeKey } from "./profile";

const MIN_EXTRACTIVE_SEGMENT_SCORE = 0.5;
const MIN_QUOTE_CHARACTERS = 20;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;
const LIST_MARKER_PATTERN = /^\s*\d+[.)]\s+/gm;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?…])\s+/;

export interface EvidenceEntry {
  readonly content: string;
  readonly index: number;
  readonly title: string;
}

export interface EvidenceBudget {
  readonly maxCharacters: number;
  readonly maxDocuments: number;
}

/** Candidate fact as returned by the model, before it has been checked against the clausulado. */
export interface FactCandidate {
  readonly claim: string;
  /** Passage numbers the model cites; the quote must appear verbatim in at least one of them. */
  readonly evidence: readonly number[];
  readonly quote: string;
  readonly topic: FactTopic;
}

/**
 * Pick usable clausulado passages (segments above the score floor, then answers, then snippets), dedupe them,
 * and number them so the model can cite by index. Returns [] when nothing usable survives.
 */
export function selectEvidenceEntries(
  items: readonly RagEvidenceItem[],
  budget: EvidenceBudget,
): readonly EvidenceEntry[] {
  const ranked = [
    ...items.filter(
      (item) =>
        item.sourceType === "extractive_segment" && (item.score === null || item.score >= MIN_EXTRACTIVE_SEGMENT_SCORE),
    ),
    ...items.filter((item) => item.sourceType === "extractive_answer"),
    ...items.filter((item) => item.sourceType === "snippet"),
  ];

  const seenContent = new Set<string>();
  const seenDocuments = new Set<string>();
  const entries: EvidenceEntry[] = [];
  let totalCharacters = 0;

  for (const item of ranked) {
    const contentKey = normalizeKey(item.content);
    if (contentKey === "" || seenContent.has(contentKey)) {
      continue;
    }

    const documentKey = item.documentId ?? `title:${item.documentTitle ?? ""}`;
    if (!seenDocuments.has(documentKey) && seenDocuments.size >= budget.maxDocuments) {
      continue;
    }

    if (totalCharacters + item.content.length > budget.maxCharacters) {
      continue;
    }

    seenContent.add(contentKey);
    seenDocuments.add(documentKey);
    totalCharacters += item.content.length;
    entries.push({
      content: item.content,
      index: entries.length + 1,
      title: item.documentTitle ?? "Documento sin título",
    });
  }

  return entries;
}

/** Render numbered evidence for a prompt. */
export function formatEvidence(entries: readonly EvidenceEntry[]): string {
  return entries.map((entry) => `[${entry.index}] ${entry.title}: ${entry.content}`).join("\n\n");
}

/** Whitespace/accents/case-insensitive containment, so a quote survives PDF line breaks but not rewording. */
export function containsQuote(haystack: string, quote: string): boolean {
  const collapse = (value: string): string => normalizeKey(value).replace(/\s+/g, " ");
  const needle = collapse(quote);
  return needle.length >= MIN_QUOTE_CHARACTERS && collapse(haystack).includes(needle);
}

/** Numeric tokens with thousands/decimal separators removed, ignoring "1." style list markers. */
export function numericTokens(text: string): readonly string[] {
  return (text.replace(LIST_MARKER_PATTERN, "").match(NUMBER_PATTERN) ?? []).map((token) => token.replace(/[.,]/g, ""));
}

/** True when every number in `text` also appears somewhere in `sources`. */
export function numbersSupported(text: string, sources: readonly string[]): boolean {
  const allowed = new Set(sources.flatMap((source) => numericTokens(source)));
  return numericTokens(text).every((token) => allowed.has(token));
}

/** Drop the sentences that state a number found in none of the sources; returns "" when nothing is left. */
export function dropUnsupportedSentences(text: string, sources: readonly string[]): string {
  return text
    .split(SENTENCE_SPLIT_PATTERN)
    .filter((sentence) => numbersSupported(sentence, sources))
    .join(" ")
    .trim();
}

/**
 * Keep only the candidates whose quote appears verbatim in the cited passage and whose numbers all
 * appear in that quote. Everything else is discarded: an unverifiable claim is never shown as clausulado.
 */
export function verifyFacts(
  candidates: readonly FactCandidate[],
  entries: readonly EvidenceEntry[],
): readonly VerifiedFact[] {
  const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
  const seenQuotes = new Set<string>();
  const verified: VerifiedFact[] = [];

  for (const candidate of candidates) {
    const entry = candidate.evidence
      .map((index) => byIndex.get(index))
      .find((cited) => cited !== undefined && containsQuote(cited.content, candidate.quote));
    if (entry === undefined) {
      continue;
    }

    if (!numbersSupported(candidate.claim, [candidate.quote])) {
      continue;
    }

    const quoteKey = normalizeKey(candidate.quote);
    if (seenQuotes.has(quoteKey)) {
      continue;
    }

    seenQuotes.add(quoteKey);
    verified.push({
      claim: candidate.claim,
      id: `F${verified.length + 1}`,
      quote: candidate.quote,
      source: entry.title,
      topic: candidate.topic,
    });
  }

  return verified;
}
