/* ==========================================
   MD reader — CodeMirror Markdown highlight
   Shared by the editor bundle and node-level checks.
   ========================================== */

const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { HighlightStyle, syntaxHighlighting } = require('@codemirror/language');
const { tags: t, Tag, styleTags } = require('@lezer/highlight');

const markTags = {
  heading: Tag.define('mdHeadingMark', t.processingInstruction),
  emphasis: Tag.define('mdEmphasisMark', t.processingInstruction),
  link: Tag.define('mdLinkMark', t.processingInstruction),
  quote: Tag.define('mdQuoteMark', t.processingInstruction),
  list: Tag.define('mdListMark', t.processingInstruction),
  code: Tag.define('mdCodeMark', t.processingInstruction),
  table: Tag.define('mdTableMark', t.processingInstruction),
  strike: Tag.define('mdStrikeMark', t.processingInstruction),
};

const markdownMarkExtension = {
  props: [
    styleTags({
      HeaderMark: markTags.heading,
      EmphasisMark: markTags.emphasis,
      LinkMark: markTags.link,
      QuoteMark: markTags.quote,
      ListMark: markTags.list,
      CodeMark: markTags.code,
      TableDelimiter: markTags.table,
      StrikethroughMark: markTags.strike,
      SubscriptMark: markTags.emphasis,
      SuperscriptMark: markTags.emphasis,
    }),
  ],
};

const markReset = {
  fontWeight: '400',
  fontStyle: 'normal',
  textDecoration: 'none',
};

function markdownHighlightStyle() {
  return HighlightStyle.define([
    { tag: t.heading1, fontSize: '18px', fontWeight: '700', color: 'var(--md-heading)', lineHeight: '1.4' },
    { tag: t.heading2, fontSize: '16px', fontWeight: '600', color: 'var(--md-heading)', lineHeight: '1.45' },
    { tag: t.heading3, fontWeight: '600', color: 'var(--md-heading-muted)' },
    { tag: t.heading4, fontWeight: '600', color: 'var(--md-heading-muted)' },
    { tag: t.heading5, fontWeight: '600', color: 'var(--md-heading-muted)' },
    { tag: t.heading6, fontWeight: '600', color: 'var(--md-heading-muted)' },
    { tag: t.strong, fontWeight: '700', color: 'var(--md-strong)' },
    { tag: t.emphasis, fontStyle: 'italic', color: 'var(--md-emphasis)' },
    { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--md-strikethrough)' },
    { tag: t.link, color: 'var(--md-link)' },
    { tag: t.url, color: 'var(--md-url)' },
    { tag: t.quote, color: 'var(--md-quote)' },
    { tag: t.monospace, color: 'var(--md-code)' },
    { tag: t.labelName, color: 'var(--md-url)' },
    { tag: t.string, color: 'var(--md-url)' },
    { tag: t.comment, color: 'var(--md-comment)', fontStyle: 'italic' },
    { tag: t.contentSeparator, color: 'var(--md-hr)' },
    { tag: t.escape, color: 'var(--md-comment)' },
    { tag: t.processingInstruction, color: 'var(--md-mark-list)', ...markReset },
    { tag: markTags.heading, color: 'var(--md-mark-heading)', ...markReset },
    { tag: markTags.emphasis, color: 'var(--md-mark-emphasis)', ...markReset },
    { tag: markTags.link, color: 'var(--md-mark-link)', ...markReset },
    { tag: markTags.quote, color: 'var(--md-mark-quote)', ...markReset },
    { tag: markTags.list, color: 'var(--md-mark-list)', ...markReset },
    { tag: markTags.code, color: 'var(--md-mark-code)', ...markReset },
    { tag: markTags.table, color: 'var(--md-mark-table)', ...markReset },
    { tag: markTags.strike, color: 'var(--md-mark-strike)', ...markReset },
  ]);
}

function markdownEditorLanguage() {
  return markdown({
    base: markdownLanguage,
    extensions: markdownMarkExtension,
  });
}

function markdownHighlighting() {
  return syntaxHighlighting(markdownHighlightStyle(), { fallback: true });
}

module.exports = {
  markTags,
  markdownMarkExtension,
  markdownEditorLanguage,
  markdownHighlightStyle,
  markdownHighlighting,
};
