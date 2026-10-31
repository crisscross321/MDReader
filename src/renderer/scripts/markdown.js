/* ==========================================
   MD reader — Markdown core (pure, no DOM)
   Shared by the preview bundle and the node regression tests, so the
   tests exercise the exact same rules the app renders with.
   ========================================== */

const markdownIt = require('markdown-it');
const footnote = require('markdown-it-footnote');
const hljs = require('highlight.js/lib/core');

// ---- Highlight.js: register common languages only (keeps the bundle small) ----
const languages = {
  bash: require('highlight.js/lib/languages/bash'),
  c: require('highlight.js/lib/languages/c'),
  cpp: require('highlight.js/lib/languages/cpp'),
  csharp: require('highlight.js/lib/languages/csharp'),
  css: require('highlight.js/lib/languages/css'),
  diff: require('highlight.js/lib/languages/diff'),
  dockerfile: require('highlight.js/lib/languages/dockerfile'),
  go: require('highlight.js/lib/languages/go'),
  ini: require('highlight.js/lib/languages/ini'),
  java: require('highlight.js/lib/languages/java'),
  javascript: require('highlight.js/lib/languages/javascript'),
  json: require('highlight.js/lib/languages/json'),
  kotlin: require('highlight.js/lib/languages/kotlin'),
  lua: require('highlight.js/lib/languages/lua'),
  makefile: require('highlight.js/lib/languages/makefile'),
  markdown: require('highlight.js/lib/languages/markdown'),
  php: require('highlight.js/lib/languages/php'),
  plaintext: require('highlight.js/lib/languages/plaintext'),
  powershell: require('highlight.js/lib/languages/powershell'),
  python: require('highlight.js/lib/languages/python'),
  ruby: require('highlight.js/lib/languages/ruby'),
  rust: require('highlight.js/lib/languages/rust'),
  scss: require('highlight.js/lib/languages/scss'),
  shell: require('highlight.js/lib/languages/shell'),
  sql: require('highlight.js/lib/languages/sql'),
  swift: require('highlight.js/lib/languages/swift'),
  typescript: require('highlight.js/lib/languages/typescript'),
  xml: require('highlight.js/lib/languages/xml'),
  yaml: require('highlight.js/lib/languages/yaml'),
};
Object.keys(languages).forEach((name) => hljs.registerLanguage(name, languages[name]));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Front matter (YAML between leading --- fences) ----

function extractFrontMatter(lines) {
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      return { lines: lines.slice(1, i), endLine: i };
    }
  }
  return null;
}

function renderFrontMatter(fmLines, label) {
  // Top-level "key: value" pairs; indented / list lines continue the previous key.
  const rows = [];
  for (const line of fmLines) {
    const m = /^([A-Za-z0-9_\-\u0080-\uFFFF][^:]*):\s?(.*)$/.exec(line);
    if (m && !/^\s/.test(line)) rows.push({ key: m[1].trim(), value: m[2] });
    else if (rows.length && line.trim()) rows[rows.length - 1].value += '\n' + line;
  }
  const titleRow = rows.find((r) => r.key.toLowerCase() === 'title');
  const summary = titleRow && titleRow.value.trim()
    ? `${escapeHtml(label)} · ${escapeHtml(titleRow.value.trim().replace(/^["']|["']$/g, ''))}`
    : escapeHtml(label);
  const body = rows.length
    ? '<table><tbody>' +
      rows.map((r) => `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value.trim())}</td></tr>`).join('') +
      '</tbody></table>'
    : `<pre><code>${escapeHtml(fmLines.join('\n'))}</code></pre>`;
  return `<details class="front-matter" data-source-line="0"><summary>${summary}</summary>${body}</details>\n`;
}

// ---- Table gap normalization ----

function isCommentOnlyLine(line) {
  return /^\s*<!--[\s\S]*?-->\s*$/.test(line);
}

function isTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  if (isCommentOnlyLine(trimmed)) return false;
  return trimmed.startsWith('|') || trimmed.endsWith('|');
}

function isTableSeparator(line) {
  const trimmed = line.trim();
  return /^[\s|:-]+$/.test(trimmed) && trimmed.includes('|') && trimmed.includes('-');
}

function isSkippableTableGap(line) {
  return !line.trim() || isCommentOnlyLine(line);
}

function nextMeaningfulLine(lines, startIndex) {
  let index = startIndex;
  while (index < lines.length && isSkippableTableGap(lines[index])) index += 1;
  return { index, line: index < lines.length ? lines[index] : null, skipped: index > startIndex };
}

/**
 * Normalize table gaps (blank lines / HTML comments inside tables) and peel
 * off front matter. Returns { text, map, frontMatter } where map[i] = original
 * source line of normalized line i, keeping scroll-sync anchors accurate.
 */
function normalizeMarkdown(markdownString) {
  const lines = (markdownString || '').replace(/\r\n?/g, '\n').split('\n');
  const fm = extractFrontMatter(lines);
  const normalized = [];
  const map = [];

  for (let i = fm ? fm.endLine + 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (isTableRow(line) && isTableSeparator(nextLine || '')) {
      normalized.push(line, nextLine);
      map.push(i, i + 1);
      i += 1;

      while (i + 1 < lines.length) {
        const { index: lookahead, line: candidate, skipped } = nextMeaningfulLine(lines, i + 1);
        if (candidate === null) {
          i = lines.length;
          break;
        }
        if (!isTableRow(candidate)) {
          if (skipped) {
            normalized.push('');
            map.push(i + 1);
          }
          i = lookahead - 1;
          break;
        }
        const nextAfterCandidate = nextMeaningfulLine(lines, lookahead + 1);
        if (skipped && isTableSeparator(nextAfterCandidate.line || '')) {
          normalized.push('');
          map.push(lookahead);
          i = lookahead - 1;
          break;
        }
        normalized.push(candidate);
        map.push(lookahead);
        i = lookahead;
      }
      continue;
    }

    normalized.push(line);
    map.push(i);
  }

  return { text: normalized.join('\n'), map, frontMatter: fm ? fm.lines : null };
}

// ---- Heading ids (GitHub-style slugs) ----

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function inlineText(token) {
  return (token.children || [])
    .filter((c) => c.type === 'text' || c.type === 'code_inline')
    .map((c) => c.content)
    .join('');
}

// ---- Plugins ----

function taskListRule(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'inline') continue;
    if (tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;

    const m = /^\[([ xX])\]\s+/.exec(token.content);
    if (!m) continue;

    const rest = token.content.slice(m[0].length);
    token.content = rest;
    const cbToken = new state.Token('html_inline', '', 0);
    cbToken.content = m[1] !== ' '
      ? '<input type="checkbox" checked disabled> '
      : '<input type="checkbox" disabled> ';
    const textToken = token.children.find((c) => c.type === 'text');
    if (textToken) textToken.content = textToken.content.replace(/^\[([ xX])\]\s+/, '');
    token.children.unshift(cbToken);
  }
}

const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'];

function alertRule(state) {
  const labels = (state.env && state.env.alertLabels) || {};
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue;
    if (tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue;
    const inline = tokens[i + 2];
    const m = /^\[!(note|tip|important|warning|caution)\][ \t]*(\n|$)/i.exec(inline.content);
    if (!m) continue;

    const type = m[1].toLowerCase();
    tokens[i].attrJoin('class', `markdown-alert markdown-alert-${type}`);
    inline.content = inline.content.slice(m[0].length);

    const children = inline.children || [];
    const first = children[0];
    if (first && first.type === 'text') {
      first.content = first.content.replace(/^\[![A-Za-z]+\][ \t]*/, '');
      if (!first.content) children.shift();
    }
    if (children[0] && (children[0].type === 'softbreak' || children[0].type === 'hardbreak')) {
      children.shift();
    }
    const title = new state.Token('html_inline', '', 0);
    const label = labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
    title.content = `<span class="markdown-alert-title">${escapeHtml(label)}</span>`;
    children.unshift(title);
    inline.children = children;
  }
}

function headingIdRule(state) {
  const used = {};
  const tokens = state.tokens;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open' || token.attrGet('id')) continue;
    const base = slugify(inlineText(tokens[i + 1]));
    if (!base) continue;
    let slug = base;
    if (used[base] !== undefined) {
      used[base] += 1;
      slug = `${base}-${used[base]}`;
    } else {
      used[base] = 0;
    }
    token.attrSet('id', slug);
  }
}

// Tag block-level tokens with data-source-line so the preview can be
// scrolled to match the source editor (and vice versa).
function sourceLineRule(state) {
  const map = state.env.offsetMap;
  if (!map) return;
  for (const token of state.tokens) {
    if (!token.map) continue;
    const isBlockOpen = token.type.endsWith('_open');
    const isSelfClose = token.type === 'hr' || token.type === 'fence' || token.type === 'code_block';
    if (!isBlockOpen && !isSelfClose) continue;
    const origLine = map[token.map[0]];
    if (origLine !== undefined) token.attrSet('data-source-line', String(origLine));
  }
}

/**
 * Create a configured markdown-it instance.
 * @param {{breaks?: boolean, typographer?: boolean}} [options]
 */
function createMarkdown(options = {}) {
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: options.typographer !== false,
    breaks: options.breaks !== false,
    // Return only the highlighted inner HTML: markdown-it then wraps it in
    // <pre><code> carrying the fence token attrs (incl. data-source-line).
    // An empty string makes markdown-it escape the code itself.
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        } catch (_) {
          /* fall through */
        }
      }
      return '';
    },
  });

  md.use(footnote);
  // After text_join so the leading "[ ]" sits in a single text token.
  md.core.ruler.after('text_join', 'task-list', taskListRule);
  md.core.ruler.after('task-list', 'alert', alertRule);
  md.core.ruler.after('alert', 'heading-id', headingIdRule);
  md.core.ruler.push('source-line', sourceLineRule);
  return md;
}

/**
 * Render markdown to an HTML string.
 * @param {object} md - instance from createMarkdown
 * @param {string} source
 * @param {{frontMatterLabel?: string, alertLabels?: object}} [labels]
 */
function renderMarkdown(md, source, labels = {}) {
  const { text, map, frontMatter } = normalizeMarkdown(source);
  const env = { offsetMap: map, alertLabels: labels.alertLabels };
  const head = frontMatter ? renderFrontMatter(frontMatter, labels.frontMatterLabel || 'Front matter') : '';
  return head + md.render(text, env);
}

module.exports = {
  createMarkdown,
  renderMarkdown,
  normalizeMarkdown,
  slugify,
  ALERT_TYPES,
};
