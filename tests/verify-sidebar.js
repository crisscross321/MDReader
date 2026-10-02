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
  const compound = sel.match(/^\.([A-Za-z0-9_-]+)\[data-doc-id="([^"]+)"\]$/);
  if (compound) {
    return el.classList.contains(compound[1]) && el.dataset.docId === compound[2];
  }
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
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
    parentNode: null,
    children: [],
    _html: '',
  };

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
window.MDReaderTheme = { init() {}, toggle() {} };
window.MDReaderPreview = { updatePreview() {} };
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
  hooks.fileOpened({
    path: '/docs/file<img>.md',
    content: '# Title\n\nBody text that should appear\n',
  });
  hooks.fileOpened({
    path: '/docs/second.md',
    content: 'Second file line\n',
  });

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
}

main().then(() => {
  console.log(failures === 0 ? '\nAll checks passed ✔' : `\n${failures} check(s) FAILED ✘`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
