/* ==========================================
   MD reader — Sidebar regression checks
   Run: node tests/verify-sidebar.js
   Loads src/renderer/scripts/app.js against a small DOM stand-in.
   ========================================== */

const path = require('path');

let failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function matches(el, sel) {
  if (sel.includes(',')) {
    return sel.split(',').some((part) => matches(el, part.trim()));
  }
  const compound = sel.match(/^\.([A-Za-z0-9_-]+)\[data-doc-id="([^"]+)"\]$/);
  if (compound) {
    return el.classList.contains(compound[1]) && el.dataset.docId === compound[2];
  }
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (/^h[1-6]$/i.test(sel)) return el.tagName.toLowerCase() === sel.toLowerCase();
  return false;
}

function queryAll(root, sel) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (matches(child, sel)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function createElement(tag) {
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    dataset: {},
    style: {},
    title: '',
    type: '',
    textContent: '',
    scrollTop: 0,
    offsetTop: 0,
    offsetParent: null,
    parentNode: null,
    children: [],
    _html: '',
  };

  Object.defineProperty(el, 'firstChild', {
    get() { return el.children[0] || null; },
  });

  el.classList = {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    toggle(name, force) {
      const on = force === undefined ? !classes.has(name) : !!force;
      if (on) classes.add(name);
      else classes.delete(name);
      return on;
    },
    contains(name) { return classes.has(name); },
  };

  el.appendChild = (child) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = el;
    el.children.push(child);
    return child;
  };
  el.append = (...nodes) => nodes.forEach((node) => el.appendChild(node));
  el.insertBefore = (child, anchor) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = el;
    if (!anchor) el.children.push(child);
    else {
      const index = el.children.indexOf(anchor);
      el.children.splice(index < 0 ? el.children.length : index, 0, child);
    }
    return child;
  };
  el.removeChild = (child) => {
    const index = el.children.indexOf(child);
    if (index >= 0) el.children.splice(index, 1);
    if (child.parentNode === el) child.parentNode = null;
    return child;
  };
  el.remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el);
  };
  el.closest = (sel) => {
    let node = el;
    while (node) {
      if (matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  };
  el.querySelector = (sel) => queryAll(el, sel)[0] || null;
  el.querySelectorAll = (sel) => queryAll(el, sel);
  el.addEventListener = (type, fn) => {
    el._listeners = el._listeners || {};
    (el._listeners[type] = el._listeners[type] || []).push(fn);
  };
  el.setAttribute = (name, value) => {
    el._attrs = el._attrs || {};
    el._attrs[name] = String(value);
  };
  el.removeAttribute = (name) => {
    if (el._attrs) delete el._attrs[name];
  };
  el.getAttribute = (name) => (el._attrs && name in el._attrs ? el._attrs[name] : null);

  // Mirrors Chromium: wiping innerHTML drops scroll position.
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return el._html; },
    set(value) {
      el._html = String(value);
      while (el.children.length) el.removeChild(el.children[0]);
      el.scrollTop = 0;
    },
  });

  return el;
}

const byId = {};
const documentMock = {
  readyState: 'complete',
  getElementById(id) {
    if (!byId[id]) {
      byId[id] = createElement('div');
      byId[id].id = id;
    }
    return byId[id];
  },
  createElement,
  addEventListener() {},
};

const hooks = {};
const recentAdded = [];
let editorOnChange = null;
let editorContent = '';

global.document = documentMock;
global.window = global;
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.NodeFilter = { SHOW_TEXT: 4 };

window.mdReader = {
  basename: (filePath) => path.basename(filePath),
  setWindowTitle() {},
  notifyRendererReady() {},
  onFileOpened(cb) { hooks.fileOpened = cb; },
  onFileChanged(cb) { hooks.fileChanged = cb; },
  onMenuAction(cb) { hooks.menu = cb; },
  onBeforeClose(cb) { hooks.beforeClose = cb; },
  onSettingsChanged(cb) { hooks.settings = cb; },
  getSettings: async () => ({ theme: 'system', breaks: true, typographer: true, recent: [] }),
  addRecent(filePath) { recentAdded.push(filePath); },
  unwatchFile() {},
  openFile: async () => null,
  readFile: async () => null,
  saveFile: async () => ({ success: true }),
  saveFileAs: async () => ({ success: true, path: '/tmp/Note.md' }),
  confirmDiscard: async () => 'discard',
  confirmReload: async () => 'reload',
  confirmClose() {},
  cancelClose() {},
};
window.MDReaderTheme = { toggle() {} };
window.MDReaderI18n = { lang: 'en', t: (key) => key, apply() {} };
let previewRenders = 0;
window.MDReaderPreview = {
  configure() {},
  updatePreview(markdown, container) {
    previewRenders += 1;
    while (container.children.length) container.removeChild(container.children[0]);
    String(markdown || '').split('\n').forEach((line) => {
      const match = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!match) return;
      const heading = document.createElement('h' + match[1].length);
      heading.textContent = match[2];
      container.appendChild(heading);
    });
  },
};
window.MDReaderEditor = {
  init(_container, cb) { editorOnChange = cb; },
  setContent(content) { editorContent = content; },
  getContent() { return editorContent; },
  focus() {},
  lineAtScrollTop() { return 1; },
  scrollToLine() {},
};

require('../src/renderer/scripts/app.js');

const list = document.getElementById('documentsList');

function items() {
  return list.children.filter((el) => el.classList.contains('doc-item'));
}

function findDesc(el, className) {
  for (const child of el.children) {
    if (child.classList.contains(className)) return child;
    const nested = findDesc(child, className);
    if (nested) return nested;
  }
  return null;
}

function click(el) {
  const listeners = (list._listeners && list._listeners.click) || [];
  for (const fn of listeners) {
    fn({ target: el, stopPropagation() {} });
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sidebarEl = document.getElementById('sidebar');
  const sidebarToggleEl = document.getElementById('sidebarToggle');
  const mainContentEl = document.getElementById('mainContent');

  hooks.fileOpened({
    path: '/docs/file<img>.md',
    content: '# Title\n\nBody text that should appear\n',
  });
  hooks.fileOpened({
    path: '/docs/second.md',
    content: 'Second file line\n',
  });
  check('opening documents leaves the sidebar collapsed', sidebarEl.classList.contains('visible') && sidebarEl.classList.contains('collapsed'));
  check('collapsed sidebar hides itself from assistive tech', sidebarEl.getAttribute('aria-hidden') === 'true');
  const outlineEl = document.getElementById('outline');
  check(
    'outline opens beside the document',
    outlineEl.classList.contains('visible') && !outlineEl.classList.contains('collapsed')
  );
  check(
    'documents without headings show an empty outline',
    document.getElementById('outlineList').children.some((el) => el.classList.contains('outline-empty'))
  );

  let rows = items();
  check('opens one row per document', rows.length === 2, `count=${rows.length}`);
  check('active row is the last opened file', rows[1].classList.contains('active') && !rows[0].classList.contains('active'));
  const nameEl = findDesc(rows[0], 'doc-item-name');
  check(
    'filename is written as text',
    nameEl.textContent === 'file<img>.md' && nameEl.innerHTML === '',
    JSON.stringify({ text: nameEl.textContent, html: nameEl.innerHTML })
  );
  check('snippet skips headings', findDesc(rows[0], 'doc-item-meta').textContent.includes('Body text that should appear'));
  check('meta keeps a nbsp before the snippet', findDesc(rows[0], 'doc-item-meta').textContent.includes(' \u00A0 '));

  const first = rows[0];
  const second = rows[1];
  list.scrollTop = 48;
  hooks.fileOpened({
    path: '/docs/file<img>.md',
    content: '# Title\n\nBody text that should appear\n',
  });
  rows = items();
  check('reopening a path does not duplicate the row', rows.length === 2 && rows[0] === first && rows[1] === second);
  check('reopening switches the active class on the same nodes', first.classList.contains('active') && !second.classList.contains('active'));
  check('opening or focusing a document keeps the sidebar scroll', list.scrollTop === 48, `scrollTop=${list.scrollTop}`);

  click(second);
  await flush();
  check('clicking a row activates that document', second.classList.contains('active') && !first.classList.contains('active'));
  check('switching documents keeps row nodes', items()[0] === first && items()[1] === second);
  check('switching documents keeps the sidebar scroll', list.scrollTop === 48);

  hooks.menu({ action: 'toggle-mode' });
  check('edit mode captured the editor callback', typeof editorOnChange === 'function');

  const editedPrefix = '# Title\n\nEdited snippet line\n' + 'x'.repeat(1600);
  editorContent = editedPrefix + '\nTAIL ONE';
  editorOnChange(editorContent);
  await delay(260);

  rows = items();
  check('typing does not rebuild sidebar rows', rows[0] === first && rows[1] === second);
  check('typing marks only the edited row dirty', second.classList.contains('dirty') && !first.classList.contains('dirty'));
  check('typing updates the snippet when the head changes', findDesc(second, 'doc-item-meta').textContent.includes('Edited snippet line'));
  check('typing keeps the sidebar scroll', list.scrollTop === 48, `scrollTop=${list.scrollTop}`);
  check('sidebar list is not wiped via innerHTML', list.innerHTML === '');

  const snippetBeforeTailEdit = findDesc(second, 'doc-item-meta').textContent;
  editorContent = editedPrefix + '\nTAIL TWO';
  editorOnChange(editorContent);
  await delay(260);
  check(
    'edits past the first 1500 chars leave the snippet unchanged',
    findDesc(second, 'doc-item-meta').textContent === snippetBeforeTailEdit &&
      !snippetBeforeTailEdit.includes('TAIL')
  );
  check('a later edit still reuses the same row', items()[1] === second);

  hooks.menu({ action: 'toggle-mode' });
  hooks.menu({ action: 'save-as' });
  await flush();
  await flush();
  check('save as renames the same row', items()[1] === second && findDesc(second, 'doc-item-name').textContent === 'Note.md');
  check('save clears the dirty class', !second.classList.contains('dirty'));

  const thirdBefore = items().length;
  hooks.menu({ action: 'new' });
  hooks.menu({ action: 'new' });
  rows = items();
  check('new documents append untitled rows', rows.length === thirdBefore + 2);
  check('untitled rows are distinct', rows[rows.length - 1].dataset.docId !== rows[rows.length - 2].dataset.docId);
  check('empty documents have no snippet', !findDesc(rows[rows.length - 1], 'doc-item-meta').textContent.includes('\u00A0'));

  const untitledA = rows[rows.length - 2];
  const untitledB = rows[rows.length - 1];
  click(findDesc(untitledA, 'doc-item-close'));
  await flush();
  rows = items();
  check('close removes the clicked document, not a neighbor', rows.includes(untitledB) && !rows.includes(untitledA) && rows[rows.length - 1] === untitledB);

  const kept = items()[0];
  click(findDesc(items()[1], 'doc-item-close'));
  await flush();
  check('closing a middle row leaves the others in order', items()[0] === kept && items().includes(untitledB));

  check('sidebar stays collapsed while reading', sidebarEl.classList.contains('collapsed'));

  hooks.menu({ action: 'toggle-sidebar' });
  check('toolbar toggle expands the sidebar', !sidebarEl.classList.contains('collapsed'));
  check('expand clears the pressed state', sidebarToggleEl.getAttribute('aria-pressed') === 'false');
  check('expanded sidebar is available to assistive tech', sidebarEl.getAttribute('aria-hidden') === 'false');

  hooks.menu({ action: 'toggle-sidebar' });
  check('toggling again collapses the sidebar', sidebarEl.classList.contains('collapsed'));
  check('collapse marks the toolbar button pressed', sidebarToggleEl.getAttribute('aria-pressed') === 'true');

  hooks.menu({ action: 'toggle-sidebar' });
  click(items()[0]);
  await flush();
  check('choosing a document leaves the sidebar open', !sidebarEl.classList.contains('collapsed'));

  const outlineList = document.getElementById('outlineList');
  const outlineItems = () => outlineList.children.filter((el) => el.classList.contains('outline-item'));
  check(
    'outline lists the active document headings',
    outlineItems().length === 1 && outlineItems()[0].textContent === 'Title'
  );

  const heading = document.getElementById('previewContent').children.find((el) => el.tagName === 'H1');
  heading.offsetTop = 416;
  const outlineListeners = (outlineList._listeners && outlineList._listeners.click) || [];
  outlineListeners.forEach((fn) => fn({ target: outlineItems()[0], preventDefault() {} }));
  check('jumping from the outline scrolls the article', document.getElementById('previewPane').scrollTop === 400);
  check('using the outline collapses the sidebar', sidebarEl.classList.contains('collapsed'));

  hooks.menu({ action: 'toggle-sidebar' });
  click(items().find((row) => row.classList.contains('active')));
  check('clicking the current document leaves the sidebar open', !sidebarEl.classList.contains('collapsed'));

  hooks.menu({ action: 'toggle-mode' });
  check('entering edit mode auto-collapses the sidebar', sidebarEl.classList.contains('collapsed'));

  hooks.menu({ action: 'toggle-sidebar' });
  const contentListeners = (mainContentEl._listeners && mainContentEl._listeners.mousedown) || [];
  contentListeners.forEach((fn) => fn({ target: mainContentEl }));
  check('clicking the article auto-collapses the sidebar', sidebarEl.classList.contains('collapsed'));

  hooks.menu({ action: 'toggle-sidebar' });
  click(findDesc(items()[0], 'doc-item-close'));
  await flush();
  check('closing a document leaves the sidebar open', !sidebarEl.classList.contains('collapsed'));

  hooks.fileOpened({
    path: '/docs/outline.md',
    content: '# A\n\n## B\n\n### C\n',
  });
  const levels = outlineItems();
  check(
    'outline indents nested headings',
    levels.map((el) => el.textContent).join(',') === 'A,B,C' &&
      levels[0].style.paddingLeft === '12px' &&
      levels[1].style.paddingLeft === '24px' &&
      levels[2].style.paddingLeft === '36px',
    levels.map((el) => `${el.textContent}:${el.style.paddingLeft}`).join(' ')
  );

  hooks.menu({ action: 'toggle-outline' });
  check('outline toggle hides the panel', outlineEl.classList.contains('collapsed'));
  hooks.menu({ action: 'toggle-outline' });
  check('outline toggle shows the panel again', !outlineEl.classList.contains('collapsed'));

  check('opened files are reported to the recent list', recentAdded.includes('/docs/outline.md') && recentAdded.includes('/tmp/Note.md'));

  // Each document keeps its own reading position.
  const pane = document.getElementById('previewPane');
  hooks.fileOpened({ path: '/docs/long-a.md', content: '# A\n' });
  pane.scrollTop = 900;
  hooks.fileOpened({ path: '/docs/long-b.md', content: '# B\n' });
  check('a newly opened document starts at the top', pane.scrollTop === 0, `scrollTop=${pane.scrollTop}`);
  pane.scrollTop = 120;
  hooks.fileOpened({ path: '/docs/long-a.md', content: '# A\n' });
  check('switching back restores the earlier position', pane.scrollTop === 900, `scrollTop=${pane.scrollTop}`);
  hooks.fileOpened({ path: '/docs/long-b.md', content: '# B\n' });
  check('and the other document keeps its own', pane.scrollTop === 120, `scrollTop=${pane.scrollTop}`);

  // Switching documents renders the preview exactly once.
  const before = previewRenders;
  hooks.fileOpened({ path: '/docs/long-a.md', content: '# A\n' });
  check('switching documents renders once', previewRenders - before === 1, `renders=${previewRenders - before}`);
  const beforeToggle = previewRenders;
  hooks.menu({ action: 'toggle-mode' });
  hooks.menu({ action: 'toggle-mode' });
  check('toggling modes without edits does not re-render', previewRenders === beforeToggle, `renders=${previewRenders - beforeToggle}`);

  check('the collapsed list shows how many documents are open', document.getElementById('docCount').textContent === String(items().length));
}

main().then(() => {
  console.log(failures === 0 ? '\nAll checks passed ✔' : `\n${failures} check(s) FAILED ✘`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
