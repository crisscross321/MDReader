/* ==========================================
   MD reader — Preview/Editor regression checks (node-level)
   Run: node tests/verify-preview.js
   Exercises src/renderer/scripts/markdown.js, preload.js path helpers and
   the editor highlight setup directly (no mirrored copies).
   ========================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EditorState } = require('@codemirror/state');
const { history, undo, undoDepth } = require('@codemirror/commands');
const { markdownLanguage } = require('@codemirror/lang-markdown');
const { getStyleTags } = require('@lezer/highlight');
const {
  markdownEditorLanguage,
  markdownHighlighting,
  markdownHighlightStyle,
} = require('../src/renderer/scripts/editorHighlight');
const {
  createMarkdown,
  renderMarkdown,
  normalizeMarkdown,
} = require('../src/renderer/scripts/markdown');

let failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// The app's own renderer — no mirrored copy to drift out of sync.
const md = createMarkdown();

// Load the sandboxed preload with a stub electron to test its path helpers.
function loadPreloadApi() {
  let api = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { on() {}, send() {}, invoke() {} },
    webUtils: { getPathForFile: () => '' },
  };
  const code = fs.readFileSync(path.join(__dirname, '../src/renderer/preload.js'), 'utf-8');
  vm.runInNewContext(code, {
    require: (name) => (name === 'electron' ? electron : null),
    process: { platform: 'darwin' },
    URL,
  });
  return api;
}

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
  check('setext heading renders as h1', /<h1[ >]/.test(html) && /Heading/.test(html));
}

console.log('\n== Front matter ==');
{
  const src = ['---', 'title: 笔记', 'tags:', '  - a', '---', '', '# Body', 'text'].join('\n');
  const html = renderMarkdown(md, src, { frontMatterLabel: 'Props' });
  check('front matter is not rendered as hr + heading', !/<hr/.test(html) && !/<h2/.test(html), html);
  check('front matter becomes a collapsible card', /<details class="front-matter"[^>]*><summary>Props · 笔记<\/summary>/.test(html), html);
  check('front matter keeps nested values', /<th>tags<\/th><td>- a/.test(html), html);
  check('body anchors keep original line numbers', /<h1[^>]*data-source-line="6"/.test(html), html);
  const noFm = renderMarkdown(md, 'text\n\n---\n\nmore');
  check('a later --- is still a thematic break', /<hr/.test(noFm) && !/front-matter/.test(noFm));
}

console.log('\n== Heading ids / footnotes / alerts / code ==');
{
  const html = md.render('# Hello World!\n\n## Hello World!\n\n### 中文 标题');
  check('heading gets a GitHub-style slug', /<h1 id="hello-world">/.test(html), html);
  check('duplicate headings get a numeric suffix', /<h2 id="hello-world-1">/.test(html), html);
  check('CJK headings keep their text in the slug', /<h3 id="中文-标题">/.test(html), html);

  const fn = md.render('Claim[^1]\n\n[^1]: Source');
  check('footnote reference links to the note', /href="#fn1"/.test(fn) && /id="fn1"/.test(fn), fn);

  const alert = renderMarkdown(md, '> [!WARNING]\n> Careful', { alertLabels: { warning: '警告' } });
  check('alert blockquote gets a type class', /class="markdown-alert markdown-alert-warning"/.test(alert), alert);
  check('alert shows the localized title', /markdown-alert-title">警告</.test(alert), alert);
  check('alert marker text is removed', !/\[!WARNING\]/.test(alert), alert);
  check('plain blockquote stays plain', !/markdown-alert/.test(md.render('> just a quote')));

  const task = md.render('- [ ] todo **bold** tail');
  check('task text with inline markup is not duplicated', (task.match(/tail/g) || []).length === 1 && /<strong>bold<\/strong>/.test(task), task);

  const code = renderMarkdown(md, 'a\n\n```swift\nlet x = 1\n```\n\n```nolang\n<b>\n```');
  check('swift is highlighted', /class="language-swift"[\s\S]*hljs-keyword/.test(code), code);
  check('code blocks carry a source line anchor', /<code data-source-line="2"/.test(code), code);
  check('unknown languages are escaped', /&lt;b&gt;/.test(code), code);
}

console.log('\n== Rendering switches ==');
{
  const soft = createMarkdown({ breaks: false, typographer: false }).render('a\nb (c)');
  check('breaks off keeps a soft line break', !/<br>/.test(soft), soft);
  check('typographer off keeps (c) literal', /\(c\)/.test(soft), soft);
  check('defaults keep breaks on', /<br>/.test(md.render('a\nb')));
}

console.log('\n== Local path resolution (preload) ==');
{
  const api = loadPreloadApi();
  const doc = '/Users/me/笔记 本/doc.md';
  const zh = md.render('![](./图片 素材.png)'.replace(' 素材', '%20素材'));
  const src = /src="([^"]+)"/.exec(zh)[1];
  const img = api.resolveFileUrl(doc, src);
  check('percent-encoded CJK image path resolves to the real file', img && img.path === '/Users/me/笔记 本/图片 素材.png', JSON.stringify(img));
  check('resolved URL is encoded exactly once', img && !/%25/.test(img.url), img && img.url);
  const raw = api.resolveFileUrl(doc, '../其他/图.png');
  check('raw (unencoded) relative paths resolve too', raw && raw.path === '/Users/me/其他/图.png', JSON.stringify(raw));
  const link = api.resolveFileUrl(doc, 'other.md#%E7%AB%A0%E8%8A%82');
  check('md link keeps its anchor', link && link.path === '/Users/me/笔记 本/other.md' && decodeURIComponent(link.hash) === '章节', JSON.stringify(link));
  check('http targets are not treated as local files', api.resolveFileUrl(doc, 'https://x.y/a.png') === null);
  check('basename handles both separators', api.basename('C:\\a\\b.md') === 'b.md' && api.basename('/a/b.md') === 'b.md');
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

console.log('\n== Editor markdown mark highlighting ==');
{
  const sample = [
    '# Title',
    '',
    'This is **bold** and a [link](https://example.com).',
    '',
    '> quote',
    '',
    '- item',
    '',
    '`code`',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '~~strike~~',
  ].join('\n');

  const defaultNames = [];
  markdownLanguage.parser.parse(sample).iterate({
    enter(node) {
      defaultNames.push(node.name);
    },
  });
  check('default parser emits HeaderMark', defaultNames.includes('HeaderMark'));
  check('default parser emits EmphasisMark', defaultNames.includes('EmphasisMark'));

  const languageSupport = markdownEditorLanguage();
  const tree = languageSupport.language.parser.parse(sample);
  const nodesByName = {};
  tree.iterate({
    enter(node) {
      if (!nodesByName[node.name]) nodesByName[node.name] = node.node;
    },
  });

  ['HeaderMark', 'EmphasisMark', 'LinkMark', 'QuoteMark', 'ListMark', 'CodeMark'].forEach(
    (name) => {
      check(`extended parser emits ${name}`, Boolean(nodesByName[name]));
    }
  );

  const highlighter = markdownHighlightStyle();
  function classFor(name) {
    const node = nodesByName[name];
    if (!node) return null;
    const info = getStyleTags(node);
    if (!info) return null;
    return highlighter.style(info.tags);
  }

  const headerClass = classFor('HeaderMark');
  const emphasisClass = classFor('EmphasisMark');
  const linkClass = classFor('LinkMark');
  const quoteClass = classFor('QuoteMark');
  const listClass = classFor('ListMark');
  const codeClass = classFor('CodeMark');

  check(
    'heading mark highlight class is set',
    Boolean(headerClass),
    `class=${headerClass}`
  );
  check(
    'heading and emphasis marks use different highlight classes',
    Boolean(headerClass && emphasisClass && headerClass !== emphasisClass),
    `header=${headerClass} emphasis=${emphasisClass}`
  );
  check(
    'link and quote marks use different highlight classes',
    Boolean(linkClass && quoteClass && linkClass !== quoteClass),
    `link=${linkClass} quote=${quoteClass}`
  );
  check(
    'list and code marks use different highlight classes',
    Boolean(listClass && codeClass && listClass !== codeClass),
    `list=${listClass} code=${codeClass}`
  );

  const specColors = highlighter.specs
    .map((spec) => spec.color)
    .filter((color) => typeof color === 'string');
  check(
    'highlight colors use theme CSS variables',
    specColors.some((c) => c.includes('--md-mark-heading')) &&
      specColors.some((c) => c.includes('--md-mark-emphasis')),
    `colors=${specColors.join(',')}`
  );

  let created = null;
  try {
    created = EditorState.create({
      doc: sample,
      extensions: [languageSupport, markdownHighlighting()],
    });
  } catch (err) {
    created = err;
  }
  check(
    'editor extensions create an EditorState',
    created && created.doc && created.doc.toString() === sample,
    created instanceof Error ? created.message : ''
  );
}

console.log(failures === 0 ? '\nAll checks passed ✔' : `\n${failures} check(s) FAILED ✘`);
process.exit(failures === 0 ? 0 : 1);
