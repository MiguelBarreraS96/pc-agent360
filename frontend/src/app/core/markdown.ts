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

type ListKind = 'ol' | 'ul';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Bold, italic and inline code over already-escaped text. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
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
