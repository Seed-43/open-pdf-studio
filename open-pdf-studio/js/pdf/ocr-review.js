// OCR review model: canonical OCR words, the review queue, review metadata in
// the PDF (/OPS_OCRReview on the page) and the app's own OCR text layer.
//
// Word-level problems never fail a save: a word that cannot be used (no text,
// a non-finite or empty box, oversized text) is skipped, the rest is kept.

import { PDFName, PDFArray, PDFDict, PDFBool } from 'pdf-lib';
import { pdfTextString, decodePdfTextObject } from './saver/pdf-text.js';

const N = PDFName.of;

export const MAX_OCR_WORDS = 50000;
export const MAX_OCR_TEXT = 2000;
const MAX_REVIEW_JSON = 10000000;
const REVIEW_STATUSES = ['accepted', 'corrected'];
const BOX_KEYS = ['left', 'top', 'width', 'height'];

/**
 * One OCR word in canonical form, or null when it cannot be used.
 * @param {any} word
 * @returns {{text:string,left:number,top:number,width:number,height:number,
 *   confidence:number|null,review?:{status:string,originalText:string}}|null}
 */
export function normalizeOcrWord(word) {
  if (!word || typeof word.text !== 'string' || word.text.length > MAX_OCR_TEXT) return null;
  if (!BOX_KEYS.every((key) => Number.isFinite(word[key]))) return null;
  if (word.width <= 0 || word.height <= 0) return null;
  const confidence = Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 100
    ? word.confidence
    : null;
  const out = {
    text: word.text,
    left: word.left,
    top: word.top,
    width: word.width,
    height: word.height,
    confidence,
  };
  if (word.review && REVIEW_STATUSES.includes(word.review.status)) {
    out.review = {
      status: word.review.status,
      originalText: typeof word.review.originalText === 'string'
        ? word.review.originalText.slice(0, MAX_OCR_TEXT)
        : word.text,
    };
  }
  return out;
}

/**
 * The usable words of a list, each with its position in that list
 * (`index`), plus how many were skipped. Never throws.
 * @param {any} words
 * @returns {{words: Array<object>, skipped: number}}
 */
export function usableOcrWords(words) {
  if (!Array.isArray(words)) return { words: [], skipped: 0 };
  const out = [];
  let skipped = Math.max(0, words.length - MAX_OCR_WORDS);
  const limit = Math.min(words.length, MAX_OCR_WORDS);
  for (let index = 0; index < limit; index++) {
    const word = normalizeOcrWord(words[index]);
    if (word) out.push({ ...word, index });
    else skipped++;
  }
  return { words: out, skipped };
}

/** The usable words of a list in canonical form; invalid words are left out. */
export function validOcrWords(words) {
  return usableOcrWords(words).words.map(({ index, ...word }) => word);
}

export function sortQueue(queue) {
  return queue.sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1)
    || a.page - b.page
    || a.index - b.index);
}

/**
 * Words that need a look: unknown or low confidence, or already reviewed.
 * `index` is the word's position in `results[page]`, also when other words on
 * that page are invalid and skipped.
 */
export function reviewQueue(results, threshold = 80) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('INVALID_THRESHOLD');
  const queue = [];
  for (const [page, list] of Object.entries(results || {})) {
    for (const word of usableOcrWords(list).words) {
      if (word.confidence === null || word.confidence < threshold || word.review) {
        queue.push({ ...word, page: Number(page) });
      }
    }
  }
  return sortQueue(queue);
}

/**
 * Reviews read from a file that only stores the reviewed words (version 2).
 * They are listed for information: the page's full word list is not known, so
 * they cannot be changed without a new OCR run. Pages with OCR results in
 * `skipPages` are left out; those results replace the stored reviews.
 */
export function archivedReviewQueue(archive, skipPages = {}) {
  const queue = [];
  for (const [page, list] of Object.entries(archive || {})) {
    if (Array.isArray(skipPages?.[page])) continue;
    for (const word of Array.isArray(list) ? list : []) {
      queue.push({ ...word, page: Number(page), archived: true });
    }
  }
  return queue;
}

export function reviewWord(word, { action, text, expectedText }) {
  if (word.text !== expectedText) throw new Error('STALE_OCR_WORD');
  if (!['accept', 'correct'].includes(action)) throw new Error('INVALID_ACTION');
  if (action === 'correct' && (typeof text !== 'string' || !text.trim() || text.length > MAX_OCR_TEXT)) {
    throw new Error('INVALID_TEXT');
  }
  return {
    ...word,
    text: action === 'correct' ? text : word.text,
    review: {
      status: action === 'correct' ? 'corrected' : 'accepted',
      originalText: word.review?.originalText ?? word.text,
    },
  };
}

/**
 * The characters of `text` that a font with the given code points cannot
 * show, each once, in order of appearance. Whitespace is never reported.
 * @param {string} text
 * @param {Set<number>|number[]} codePoints
 * @returns {string[]}
 */
export function unencodableCharacters(text, codePoints) {
  const known = codePoints instanceof Set ? codePoints : new Set(codePoints || []);
  const missing = [];
  for (const ch of String(text ?? '')) {
    if (/\s/.test(ch)) continue;
    if (!known.has(ch.codePointAt(0)) && !missing.includes(ch)) missing.push(ch);
  }
  return missing;
}

function reviewData(pdf, page) {
  const raw = page.node.get(N('OPS_OCRReview'));
  const value = raw && pdf.context.lookup(raw);
  const text = decodePdfTextObject(value);
  if (typeof text !== 'string' || text.length > MAX_REVIEW_JSON) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function archivedReviews(entries) {
  const reviews = [];
  for (const entry of Array.isArray(entries) ? entries.slice(0, MAX_OCR_WORDS) : []) {
    if (!Number.isInteger(entry?.index) || entry.index < 0) continue;
    const word = normalizeOcrWord({
      ...entry,
      review: { status: entry.status, originalText: entry.originalText ?? entry.text },
    });
    if (word?.review) reviews.push({ ...word, index: entry.index });
  }
  return reviews;
}

/**
 * Review metadata stored in the PDF.
 * - `complete`: pages in the old full form (version 1), with every OCR word.
 *   These can serve as the page's OCR results.
 * - `reviewsOnly`: pages in the compact form (version 2), with only the
 *   reviewed words, each with its `index` in the page's word list.
 */
export function readOcrReview(pdf) {
  const complete = {};
  const reviewsOnly = {};
  pdf.getPages().forEach((page, i) => {
    const data = reviewData(pdf, page);
    if (data?.version === 1) {
      complete[i + 1] = validOcrWords(data.words);
    } else if (data?.version === 2) {
      const reviews = archivedReviews(data.reviews);
      if (reviews.length) reviewsOnly[i + 1] = reviews;
    }
  });
  return { complete, reviewsOnly };
}

/**
 * Store the reviews of one page: only the reviewed words, and the original
 * text only where it differs. A page without reviews gets no metadata.
 * `words` are canonical words; a word's `index` (when set) is its position in
 * the page's word list, otherwise its position in `words`.
 */
export function writeOcrReview(page, words) {
  const reviews = [];
  (Array.isArray(words) ? words : []).forEach((word, position) => {
    if (!word?.review) return;
    const entry = {
      index: Number.isInteger(word.index) ? word.index : position,
      text: word.text,
      left: word.left,
      top: word.top,
      width: word.width,
      height: word.height,
      confidence: word.confidence ?? null,
      status: word.review.status,
    };
    if (word.review.originalText !== word.text) entry.originalText = word.review.originalText;
    reviews.push(entry);
  });
  if (!reviews.length) {
    removeOcrReview(page);
    return;
  }
  page.node.set(N('OPS_OCRReview'), pdfTextString(JSON.stringify({ version: 2, reviews })));
}

export function removeOcrReview(page) {
  page.node.delete(N('OPS_OCRReview'));
}

/** Remove the content streams of the app's own OCR layer from a page. */
export function removeOwnedOcrLayer(page) {
  const ctx = page.doc.context;
  const raw = page.node.get(N('Contents'));
  const value = raw && ctx.lookup(raw);
  const owned = (ref) => {
    const stream = ctx.lookup(ref);
    return stream?.dict instanceof PDFDict && stream.dict.get(N('OPS_OCRLayer')) === PDFBool.True;
  };
  if (value instanceof PDFArray) {
    for (let i = value.size() - 1; i >= 0; i--) {
      if (owned(value.get(i))) value.remove(i);
    }
  } else if (raw && owned(raw)) {
    page.node.delete(N('Contents'));
  }
}
