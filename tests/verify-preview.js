/* ==========================================
   MD reader — Preview/Editor regression checks (node-level)
   Run: node tests/verify-preview.js
   Mirrors the core logic in src/renderer/scripts/preview.js & editor.js
   ========================================== */

const markdownIt = require('markdown-it');
const { EditorState } = require('@codemirror/state');
const { history, undo, undoDepth } = require('@codemirror/commands');

let failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---------- mirror of preview.js markdown-it setup ----------
const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});
md.enable(['table', 'strikethrough']);

md.core.ruler.after('inline', 'task-list', function (state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'inline') continue;
    const prev = tokens[i - 1];
    const prevPrev = tokens[i - 2];
    if (!prev || prev.type !== 'paragraph_open') continue;
    if (!prevPrev || prevPrev.type !== 'list_item_open') continue;
    const content = token.content;
    const m = /^\[([ xX])\]\s+/.exec(content);
    if (!m) continue;
    const checked = m[1] !== ' ';
    const rest = content.slice(m[0].length);
    token.content = rest;
    const cbToken = new state.Token('html_inline', '', 0);
    cbToken.content = checked
      ? '<input type="checkbox" checked disabled> '
      : '<input type="checkbox" disabled> ';
    token.children.unshift(cbToken);
    const textToken = token.children.find((c) => c.type === 'text');
    if (textToken) textToken.content = rest;
  }
});

// ---------- mirror of normalizeMarkdown ----------
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
function normalizeMarkdown(markdownString) {
  const lines = (markdownString || '').replace(/\r\n?/g, '\n').split('\n');
  const normalized = [];
  const map = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    if (isTableRow(line) && isTableSeparator(nextLine || '')) {
      normalized.push(line);
      map.push(i);
      normalized.push(nextLine);
      map.push(i + 1);
      i += 1;
      while (i + 1 < lines.length) {
        const { index: lookahead, line: candidate, skipped } = nextMeaningfulLine(lines, i + 1);
        if (candidate === null) { i = lines.length; break; }
        if (!isTableRow(candidate)) {
          if (skipped) { normalized.push(''); map.push(i + 1); }
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
  return { text: normalized.join('\n'), map };
}

// mirror of the source-line anchor rule
md.core.ruler.push('source-line', function (state) {
  const map = state.env.offsetMap;
  if (!map) return;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.map) continue;
    const isBlockOpen = token.type.endsWith('_open');
    const isSelfClose = token.type === 'hr' || token.type === 'fence' || token.type === 'code_block';
    if (!isBlockOpen && !isSelfClose) continue;
    const origLine = map[token.map[0]];
    if (origLine !== undefined) token.attrSet('data-source-line', String(origLine));
  }
});

console.log('\n== Task list (GFM) ==');
{
  const html = md.render('- [ ] todo one\n- [x] done two\n- [ ] todo three');
  check('renders checkbox inputs', /<input type="checkbox" disabled>/.test(html) && /<input type="checkbox" checked disabled>/.test(html));
  check('counts 3 checkboxes', (html.match(/<input type="checkbox"/g) || []).length === 3, html);
  check('list stays a list', /<ul>/.test(html) && /<li>/.test(html));
}

{
  const html = md.render('* [ ] star item\n  * [x] nested item');
  check('supports "* " marker', /<input type="checkbox" disabled>/.test(html));
  const checkboxes = (html.match(/<input type="checkbox"/g) || []).length;
  check('nested task list: both checkboxes render', checkboxes === 2, `checkboxes=${checkboxes}`);
  check('nested task list: keeps nested <ul>', (html.match(/<ul>/g) || []).length >= 2, html.match(/<ul>/g));
  check('nested item is checked', /<input type="checkbox" checked disabled>/.test(html));
}

{
  const html = md.render('[ ] not a list item paragraph');
  check('plain "[ ]" paragraph is NOT converted', !/<input type="checkbox"/.test(html), html);
}

console.log('\n== Table gap / comment handling ==');
{
  const src = [
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '| 3 | 4 |',
    '',
    '<!-- note -->',
    '',
    '| 5 | 6 |',
  ].join('\n');
  const html = md.render(normalizeMarkdown(src).text);
  const rows = (html.match(/<tr>/g) || []).length;
  check('single table keeps 4 data rows', rows === 4, `rows=${rows}`);
  check('renders as ONE table', (html.match(/<table>/g) || []).length === 1, html.match(/<table>/g));
}

{
  const src = [
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '| C | D |',
    '|---|---|',
    '| 3 | 4 |',
  ].join('\n');
  const html = md.render(normalizeMarkdown(src).text);
  const tables = (html.match(/<table>/g) || []).length;
  check('two adjacent tables NOT merged', tables === 2, `tables=${tables}`);
}

console.log('\n== Anchor line mapping (scroll sync) ==');
{
  const src = [
    '| A | B |',   // 0
    '|---|---|',   // 1
    '| 1 | 2 |',   // 2
    '',            // 3 (gap)
    '| 3 | 4 |',   // 4
    '',            // 5
    '## After',    // 6
  ].join('\n');
  const { text, map } = normalizeMarkdown(src);
  // normalized: [0,1,4,5?,6] — 数据行 4 应映射回原始行 4
  const dataRowIdx = map.indexOf(4);
  check('table gap keeps later row mapped to original line', dataRowIdx >= 0, `map=${JSON.stringify(map)}`);
  // 渲染后 data-source-line 应包含 4（表格数据行）与 6（标题）
  const html = md.render(text, { offsetMap: map });
  const lines = [...html.matchAll(/data-source-line="(\d+)"/g)].map((m) => +m[1]);
  check('preview tags block elements with source lines', lines.length >= 3, `lines=${lines}`);
  check('table row anchored at line 4', lines.includes(4), `lines=${lines}`);
  check('heading anchored at line 6', lines.includes(6), `lines=${lines}`);
}

{
  const html = md.render('## H\n\nbody\n\n### H3', { offsetMap: [0, 1, 2, 3, 4] });
  const h2 = /<h2[^>]*data-source-line="0"/.test(html);
  const p = /<p[^>]*data-source-line="2"/.test(html);
  const h3 = /<h3[^>]*data-source-line="4"/.test(html);
  check('heading/paragraph anchors correct', h2 && p && h3, html);
}

console.log('\n== Setext heading preserved ==');
{
  const html = md.render('Heading\n=======\n\nBody text');
  check('setext heading renders as h1', /<h1>/.test(html) && /Heading/.test(html));
}

console.log('\n== Undo-history fix (document switching must reset history) ==');
{
  const exts = [history()];
  // Old behaviour: dispatch full replace → undoable
  let s = EditorState.create({ doc: 'DOC-A', extensions: exts });
  s = s.update({ changes: { from: 0, to: s.doc.length, insert: 'DOC-B' } }).state;
  check('old dispatch path makes undo available', undoDepth(s) > 0, `depth=${undoDepth(s)}`);

  // New behaviour: rebuild state with EditorState.create → history reset
  const fresh = EditorState.create({ doc: 'DOC-B', extensions: exts });
  check('rebuilt state has empty undo stack', undoDepth(fresh) === 0, `depth=${undoDepth(fresh)}`);

  // And undo on the rebuilt state is a no-op (returns false)
  let target = { state: fresh, dispatch: () => {} };
  const undid = undo(target);
  check('undo on rebuilt state is a no-op', undid === false, `undid=${undid}`);
}

console.log(failures === 0 ? '\nAll checks passed ✔' : `\n${failures} check(s) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
