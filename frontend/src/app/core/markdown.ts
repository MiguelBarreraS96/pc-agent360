const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BULLET_PATTERN = /^[-*+]\s+(.*)$/;
const ORDERED_PATTERN = /^\d+[.)]\s+(.*)$/;
const RULE_PATTERN = /^([-*_])(\s*\1){2,}$/;
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

type ListKind = 'ol' | 'ul';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Bold, italic and inline code over already-escaped text. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
}

/**
 * Render the small Markdown subset the agent is asked to produce (headings, bullet and numbered lists,
 * paragraphs, bold/italic). Input is escaped before formatting, so model text can never inject HTML.
 */
export function renderMarkdown(markdown: string): string {
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: ListKind | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (list !== null) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const openList = (kind: ListKind): void => {
    if (list !== kind) {
      closeList();
      html.push(`<${kind}>`);
      list = kind;
    }
  };

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (RULE_PATTERN.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      continue;
    }
    const heading = HEADING_PATTERN.exec(line);
    const bullet = BULLET_PATTERN.exec(line);
    const ordered = ORDERED_PATTERN.exec(line);

    if (line === '') {
      flushParagraph();
      closeList();
    } else if (heading !== null) {
      flushParagraph();
      closeList();
      html.push(`<h4>${renderInline(heading[2] ?? '')}</h4>`);
    } else if (bullet !== null || ordered !== null) {
      flushParagraph();
      openList(bullet !== null ? 'ul' : 'ol');
      html.push(`<li>${renderInline((bullet ?? ordered)?.[1] ?? '')}</li>`);
    } else {
      closeList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  closeList();
  return html.join('');
}

/**
 * Turn Discovery Engine highlight HTML (`<b>`, `<i>`, `<br>`, entities) into the Markdown subset above.
 * Tags are dropped before entities are decoded, so decoded `<`/`>` stay literal text and are escaped on render.
 */
export function highlightsToMarkdown(text: string): string {
  return text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*(b|strong)\s*>/gi, '**')
    .replace(/<\s*\/?\s*(i|em)\s*>/gi, '*')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#')) {
        const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? entity;
    });
}
