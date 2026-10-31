/* ==========================================
   MD reader — App Controller (Multi-Document)
   ========================================== */

(function () {
  const { t, lang } = window.MDReaderI18n;

  // State
  const state = {
    mode: 'read', // 'read' or 'edit'
    documents: [], // [{id, path, content, isDirty, openedAt, scrollTop}]
    activeIndex: -1,
    editorInitialized: false,
    docVersion: 0, // bumped on doc switch/close — invalidates pending debounce
    search: { open: false },
  };

  // DOM elements
  const appContainer = document.getElementById('appContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const recentSection = document.getElementById('recentSection');
  const recentList = document.getElementById('recentList');
  const mainContent = document.getElementById('mainContent');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const docCount = document.getElementById('docCount');
  const documentsList = document.getElementById('documentsList');
  const outline = document.getElementById('outline');
  const outlineToggle = document.getElementById('outlineToggle');
  const outlineList = document.getElementById('outlineList');
  const editorPane = document.getElementById('editorPane');
  const divider = document.getElementById('divider');
  const previewPane = document.getElementById('previewPane');
  const previewContent = document.getElementById('previewContent');
  const editorContainer = document.getElementById('editorContainer');
  const modeToggle = document.getElementById('modeToggle');
  const modeLabel = document.getElementById('modeLabel');
  const themeToggle = document.getElementById('themeToggle');
  const fileTitle = document.getElementById('fileTitle');
  const openFileBtn = document.getElementById('openFileBtn');
  const searchToggle = document.getElementById('searchToggle');
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const searchCount = document.getElementById('searchCount');
  const searchPrev = document.getElementById('searchPrev');
  const searchNext = document.getElementById('searchNext');
  const searchClose = document.getElementById('searchClose');
  const toastContainer = document.getElementById('toastContainer');

  const MODE_TRANSITION_MS = 320; // matches the .editor-pane width transition

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2600);
  }

  function activeDoc() {
    return state.documents[state.activeIndex] || null;
  }

  function docName(doc) {
    return doc.path ? window.mdReader.basename(doc.path) : t('untitled');
  }

  // Flag to suppress editor onChange during programmatic setContent
  let suppressOnChange = false;
  let closeConfirmationInFlight = false;

  function saveEditorContentToDocument() {
    const doc = activeDoc();
    if (!doc || !state.editorInitialized || state.mode !== 'edit') return;
    const content = window.MDReaderEditor.getContent();
    if (doc.content !== content) {
      doc.content = content;
      doc.isDirty = true;
    }
  }

  // ---- Scroll geometry (shared by outline, anchors and edit-mode sync) ----

  /** Offset of el from the top of the preview scroll container. */
  function offsetInPreview(el) {
    let top = 0;
    let node = el;
    while (node && node !== previewPane && node !== document.body) {
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return top;
  }

  function scrollPreviewTo(el) {
    previewPane.scrollTop = Math.max(0, offsetInPreview(el) - 16);
  }

  function viewTop(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    return el.getBoundingClientRect().top;
  }

  /** Last preview block whose source line is <= lineNo (0-based). */
  function previewElForLine(lineNo) {
    let best = null;
    for (const el of previewContent.querySelectorAll('[data-source-line]')) {
      if (parseInt(el.getAttribute('data-source-line'), 10) <= lineNo) best = el;
      else break;
    }
    return best;
  }

  /** Source line (0-based) of the block at the top of the preview viewport. */
  function previewTopLine() {
    const els = previewContent.querySelectorAll('[data-source-line]');
    const paneTop = viewTop(previewPane);
    if (els.length === 0 || paneTop === null) return 0;
    let best = els[0];
    for (const el of els) {
      if (viewTop(el) <= paneTop + 24) best = el;
      else break;
    }
    return parseInt(best.getAttribute('data-source-line'), 10) || 0;
  }

  // Programmatic scrolls must not bounce back through the scroll-sync handlers.
  let syncLockUntil = 0;
  function lockSync(ms) {
    syncLockUntil = Math.max(syncLockUntil, Date.now() + ms);
  }
  function syncLocked() {
    return Date.now() < syncLockUntil;
  }

  function alignPreviewToLine(lineNo) {
    const el = previewElForLine(lineNo);
    lockSync(80);
    if (el) scrollPreviewTo(el);
    else previewPane.scrollTop = 0;
  }

  // ---- Sidebar ----
  // The document list starts collapsed so reading keeps the full width.
  // Choosing a file leaves it open, so several documents can be compared
  // without reopening the list. It collapses on the next reading action:
  // clicking into the article, following the outline, or toggling edit mode.
  // A count badge on the toggle shows when more than one document is open.

  let sidebarCollapsed = true;

  function applySidebarState() {
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    sidebar.setAttribute('aria-hidden', sidebarCollapsed ? 'true' : 'false');
    if (sidebarCollapsed) sidebar.setAttribute('inert', '');
    else sidebar.removeAttribute('inert');
    sidebarToggle.setAttribute('aria-pressed', sidebarCollapsed ? 'true' : 'false');
    const count = state.documents.length;
    let label = t(sidebarCollapsed ? 'showSidebar' : 'hideSidebar');
    if (count > 1) label += ' · ' + t('docCount', { n: count });
    sidebarToggle.title = label;
    sidebarToggle.setAttribute('aria-label', label);
    docCount.textContent = count > 1 ? String(count) : '';
  }

  function setSidebarCollapsed(collapsed) {
    if (state.documents.length === 0) return;
    sidebarCollapsed = collapsed;
    applySidebarState();
  }

  function collapseSidebar() {
    setSidebarCollapsed(true);
  }

  function toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed);
  }

  // ---- Outline ----
  // Headings come from the rendered preview, so setext headings and anything
  // the preview hides (for example a title inside a code fence) stay in sync
  // with what the reader actually sees.

  const OUTLINE_STORAGE_KEY = 'md-reader-outline';
  let outlineEntries = [];
  let outlineActiveIndex = -1;
  let outlineScrollRaf = null;

  function readOutlineOpen() {
    try {
      return localStorage.getItem(OUTLINE_STORAGE_KEY) !== 'closed';
    } catch (err) {
      return true;
    }
  }

  function writeOutlineOpen(open) {
    try {
      localStorage.setItem(OUTLINE_STORAGE_KEY, open ? 'open' : 'closed');
    } catch (err) {
      /* preference is session-only when storage is unavailable */
    }
  }

  let outlineCollapsed = !readOutlineOpen();

  function applyOutlineState() {
    outline.classList.toggle('collapsed', outlineCollapsed);
    outline.setAttribute('aria-hidden', outlineCollapsed ? 'true' : 'false');
    if (outlineCollapsed) outline.setAttribute('inert', '');
    else outline.removeAttribute('inert');
    outlineToggle.setAttribute('aria-pressed', outlineCollapsed ? 'false' : 'true');
    const label = t(outlineCollapsed ? 'showOutline' : 'hideOutline');
    outlineToggle.title = label;
    outlineToggle.setAttribute('aria-label', label);
  }

  function setOutlineCollapsed(collapsed) {
    if (state.documents.length === 0) return;
    outlineCollapsed = collapsed;
    writeOutlineOpen(!collapsed);
    applyOutlineState();
  }

  function toggleOutline() {
    setOutlineCollapsed(!outlineCollapsed);
  }

  function headingLevel(el) {
    const level = parseInt(String(el.tagName || '').slice(1), 10);
    return Number.isFinite(level) ? level : 1;
  }

  function setOutlineCurrent(index) {
    if (index === outlineActiveIndex) return;
    outlineActiveIndex = index;
    outlineEntries.forEach((entry, i) => {
      const on = i === index;
      entry.button.classList.toggle('active', on);
      if (on) entry.button.setAttribute('aria-current', 'location');
      else entry.button.removeAttribute('aria-current');
    });
    const active = outlineEntries[index] && outlineEntries[index].button;
    if (!active || typeof active.getBoundingClientRect !== 'function') return;
    if (typeof outlineList.getBoundingClientRect !== 'function') return;
    const listRect = outlineList.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    if (btnRect.top < listRect.top) {
      outlineList.scrollTop -= listRect.top - btnRect.top;
    } else if (btnRect.bottom > listRect.bottom) {
      outlineList.scrollTop += btnRect.bottom - listRect.bottom;
    }
  }

  function updateOutlineActive() {
    if (outlineEntries.length === 0) return;
    const paneTop = viewTop(previewPane);
    if (paneTop === null) {
      setOutlineCurrent(0);
      return;
    }
    const atBottom = previewPane.scrollTop + previewPane.clientHeight >= previewPane.scrollHeight - 2;
    if (atBottom) {
      setOutlineCurrent(outlineEntries.length - 1);
      return;
    }
    let current = 0;
    for (let i = 0; i < outlineEntries.length; i++) {
      const top = viewTop(outlineEntries[i].heading);
      if (top === null) {
        setOutlineCurrent(0);
        return;
      }
      if (top <= paneTop + 32) current = i;
      else break;
    }
    setOutlineCurrent(current);
  }

  function refreshOutline() {
    const scrollTop = outlineList.scrollTop;
    outlineEntries = [];
    outlineActiveIndex = -1;
    while (outlineList.firstChild) outlineList.removeChild(outlineList.firstChild);
    if (state.activeIndex < 0) return;

    const headings = Array.from(previewContent.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter((heading) => (heading.textContent || '').trim());

    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.classList.add('outline-empty');
      empty.textContent = t('noHeadings');
      outlineList.appendChild(empty);
      return;
    }

    const minLevel = headings.reduce((min, heading) => Math.min(min, headingLevel(heading)), 6);
    headings.forEach((heading) => {
      const level = headingLevel(heading);
      const label = heading.textContent.replace(/\s+/g, ' ').trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.add('outline-item');
      button.textContent = label;
      button.title = label;
      button.style.paddingLeft = (12 + (level - minLevel) * 12) + 'px';
      button.dataset.level = String(level);
      outlineList.appendChild(button);
      outlineEntries.push({ heading, button });
    });
    outlineList.scrollTop = scrollTop;
    updateOutlineActive();
  }

  function activateOutlineEntry(index) {
    const entry = outlineEntries[index];
    if (!entry) return;
    scrollPreviewTo(entry.heading);
    const lineNo = parseInt(entry.heading.getAttribute('data-source-line') || '', 10);
    if (state.mode === 'edit' && state.editorInitialized && Number.isFinite(lineNo)) {
      window.MDReaderEditor.scrollToLine(lineNo + 1);
    }
    setOutlineCurrent(index);
    collapseSidebar();
  }

  function onPreviewScrollForOutline() {
    if (outlineScrollRaf) return;
    outlineScrollRaf = requestAnimationFrame(() => {
      outlineScrollRaf = null;
      updateOutlineActive();
    });
  }

  // ---- Preview rendering ----
  // Skips work when the active document, its content and the render options
  // are unchanged, so switching modes or documents renders exactly once.

  let rendered = { doc: null, content: null, path: null, options: 0 };
  let renderOptionsVersion = 0;

  function renderPreview(force) {
    const doc = activeDoc();
    if (!doc) return;
    const same =
      rendered.doc === doc &&
      rendered.content === doc.content &&
      rendered.path === doc.path &&
      rendered.options === renderOptionsVersion;
    if (same && !force) return;
    window.MDReaderPreview.updatePreview(doc.content, previewContent, doc.path);
    rendered = { doc, content: doc.content, path: doc.path, options: renderOptionsVersion };
    reapplySearch();
    refreshOutline();
  }

  function scrollToAnchor(id) {
    if (!id) return;
    let target = null;
    try {
      target = document.getElementById(decodeURIComponent(id));
    } catch (_) {
      target = document.getElementById(id);
    }
    if (target && previewContent.contains(target)) scrollPreviewTo(target);
  }

  // Document identity is a monotonic id. Array indexes go stale across splice,
  // and several Untitled docs share a null path, so neither can key the DOM.

  let nextDocumentId = 1;
  const docViews = new WeakMap();

  function createDocumentRecord({ path, content, isDirty = false }) {
    return {
      id: nextDocumentId++,
      path,
      content,
      isDirty,
      openedAt: Date.now(),
      scrollTop: 0,
    };
  }

  function formatOpenedAt(openedAt) {
    return new Date(openedAt).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Snippet only looks at the first 1500 chars. Cache it until that head changes.
  function viewFor(doc) {
    let view = docViews.get(doc);
    if (!view) {
      view = { timeLabel: formatOpenedAt(doc.openedAt), snippet: '', snippetHead: null };
      docViews.set(doc, view);
    }
    const head = doc.content.slice(0, 1500);
    if (view.snippetHead !== head) {
      view.snippetHead = head;
      const previewLine = head.split('\n').find((line) => line.trim() && !line.startsWith('#')) || '';
      view.snippet = previewLine.substring(0, 30).trim();
    }
    return view;
  }

  function paintDocItem(item, doc) {
    const view = viewFor(doc);
    item.classList.toggle('active', activeDoc() === doc);
    item.classList.toggle('dirty', !!doc.isDirty);

    const name = docName(doc);
    const nameEl = item.querySelector('.doc-item-name');
    if (nameEl.textContent !== name) nameEl.textContent = name;

    const meta = view.snippet ? `${view.timeLabel} \u00A0 ${view.snippet}` : view.timeLabel;
    const metaEl = item.querySelector('.doc-item-meta');
    if (metaEl.textContent !== meta) metaEl.textContent = meta;
  }

  function createDocItem(doc) {
    const item = document.createElement('div');
    item.classList.add('doc-item');
    item.dataset.docId = String(doc.id);

    const dirty = document.createElement('span');
    dirty.classList.add('doc-item-dirty');

    const info = document.createElement('div');
    info.classList.add('doc-item-info');

    const name = document.createElement('div');
    name.classList.add('doc-item-name');

    const meta = document.createElement('div');
    meta.classList.add('doc-item-meta');

    const close = document.createElement('button');
    close.classList.add('doc-item-close');
    close.type = 'button';
    close.title = t('close');
    close.textContent = '\u00D7';

    info.append(name, meta);
    item.append(dirty, info, close);
    paintDocItem(item, doc);
    return item;
  }

  function documentIndexById(id) {
    const key = String(id);
    return state.documents.findIndex((doc) => String(doc.id) === key);
  }

  // Reconcile the list in place so open/close/switch/save do not reset scrollTop.
  function syncSidebar() {
    const scrollTop = documentsList.scrollTop;
    const existing = new Map();
    for (const child of Array.from(documentsList.children)) {
      if (child.classList.contains('doc-item') && child.dataset.docId) {
        existing.set(child.dataset.docId, child);
      }
    }

    const keep = new Set();
    state.documents.forEach((doc, index) => {
      const id = String(doc.id);
      keep.add(id);
      let item = existing.get(id);
      if (!item) {
        item = createDocItem(doc);
        existing.set(id, item);
      } else {
        paintDocItem(item, doc);
      }
      const anchor = documentsList.children[index];
      if (anchor !== item) {
        documentsList.insertBefore(item, anchor || null);
      }
    });

    for (const [id, item] of existing) {
      if (!keep.has(id)) item.remove();
    }

    if (documentsList.scrollTop !== scrollTop) {
      documentsList.scrollTop = scrollTop;
    }
    applySidebarState();
  }

  // Edit ticks only repaint the row whose content changed.
  function patchSidebarDocument(doc) {
    const item = documentsList.querySelector(`.doc-item[data-doc-id="${doc.id}"]`);
    if (!item) {
      syncSidebar();
      return;
    }
    paintDocItem(item, doc);
  }

  documentsList.addEventListener('click', (e) => {
    const item = e.target.closest('.doc-item');
    if (!item || item.dataset.docId === undefined) return;
    const index = documentIndexById(item.dataset.docId);
    if (index < 0) return;

    if (e.target.closest('.doc-item-close')) {
      e.stopPropagation();
      closeDocument(index);
      return;
    }
    switchDocument(index);
  });

  // ---- Document Management ----

  /** Remember where the reader was before leaving the active document. */
  function saveCurrentDocState() {
    const doc = activeDoc();
    if (!doc) return;
    saveEditorContentToDocument();
    doc.scrollTop = previewPane.scrollTop;
  }

  function loadFiles(dataList) {
    if (!Array.isArray(dataList) || dataList.length === 0) return;

    let lastIndex = -1;
    let addedAny = false;
    for (const data of dataList) {
      if (!data) continue;

      const existingIndex = state.documents.findIndex((d) => d.path === data.path);
      if (existingIndex >= 0) {
        lastIndex = existingIndex;
        continue;
      }

      state.documents.push(createDocumentRecord({ path: data.path, content: data.content }));
      if (data.path) window.mdReader.addRecent(data.path);
      lastIndex = state.documents.length - 1;
      addedAny = true;
    }

    if (lastIndex < 0) return;
    if (!addedAny && lastIndex === state.activeIndex) return;

    activateDocument(lastIndex);
  }

  function showDocumentUI() {
    welcomeScreen.style.display = 'none';
    previewPane.style.display = '';
    modeToggle.style.display = '';
    searchToggle.style.display = '';
    sidebarToggle.style.display = '';
    outlineToggle.style.display = '';
    sidebar.classList.add('visible');
    outline.classList.add('visible');
    applyOutlineState();
  }

  function showWelcomeUI() {
    closeSearch();
    welcomeScreen.style.display = '';
    previewPane.style.display = 'none';
    modeToggle.style.display = 'none';
    searchToggle.style.display = 'none';
    sidebarToggle.style.display = 'none';
    outlineToggle.style.display = 'none';
    sidebarCollapsed = true;
    sidebar.classList.remove('visible');
    outline.classList.remove('visible');
    applyOutlineState();
    fileTitle.textContent = 'MD reader';
    fileTitle.title = '';
    window.mdReader.setWindowTitle('MD reader');
    previewContent.innerHTML = '';
    rendered = { doc: null, content: null, path: null, options: 0 };
    refreshOutline();
    setMode('read');
  }

  /** Make documents[index] active: leaves edit mode, renders once, restores its scroll. */
  function activateDocument(index) {
    saveCurrentDocState();
    state.activeIndex = index;
    state.docVersion += 1;
    showDocumentUI();
    setMode('read');
    displayActiveDocument();
    syncSidebar();
  }

  function switchDocument(index) {
    if (index === state.activeIndex) return;
    if (index < 0 || index >= state.documents.length) return;
    activateDocument(index);
  }

  async function closeDocument(index) {
    if (index < 0 || index >= state.documents.length) return;

    // Flush editor content so the dirty check sees the latest text
    saveCurrentDocState();
    const doc = state.documents[index];
    const ok = await confirmDiscardIfDirty(doc);
    if (!ok) return;

    const closingActive = doc === activeDoc();
    const nowIndex = state.documents.indexOf(doc);
    if (nowIndex < 0) return;
    if (doc.path) window.mdReader.unwatchFile(doc.path);
    state.documents.splice(nowIndex, 1);
    state.docVersion += 1;

    if (state.documents.length === 0) {
      state.activeIndex = -1;
      showWelcomeUI();
      syncSidebar();
      return;
    }

    if (closingActive) {
      state.activeIndex = -1; // nothing to save for the closed doc
      activateDocument(Math.min(nowIndex, state.documents.length - 1));
      return;
    }
    if (nowIndex < state.activeIndex) state.activeIndex--;
    syncSidebar();
  }

  async function closeActiveDocument() {
    if (state.activeIndex < 0) {
      // No document open — close the window instead
      window.close();
      return;
    }
    await closeDocument(state.activeIndex);
  }

  async function hasUnsavedChangesAndConfirm() {
    if (closeConfirmationInFlight) return false;

    closeConfirmationInFlight = true;
    saveCurrentDocState();
    try {
      for (const doc of state.documents.filter((d) => d.isDirty)) {
        if (!(await confirmDiscardIfDirty(doc))) return false;
      }
      return true;
    } finally {
      closeConfirmationInFlight = false;
    }
  }

  function displayActiveDocument() {
    const doc = activeDoc();
    if (!doc) return;

    updateTitle();
    renderPreview();
    previewPane.scrollTop = doc.scrollTop || 0;

    if (state.editorInitialized) {
      suppressOnChange = true;
      window.MDReaderEditor.setContent(doc.content);
      suppressOnChange = false;
    }
  }

  // ---- File Operations ----

  function newDocument() {
    saveCurrentDocState();
    state.documents.push(createDocumentRecord({ path: null, content: '' }));
    state.activeIndex = -1;
    activateDocument(state.documents.length - 1);
  }

  async function openFile() {
    const docs = await window.mdReader.openFile();
    if (docs) loadFiles(docs);
  }

  async function openPath(filePath, hash) {
    const data = await window.mdReader.readFile(filePath);
    if (!data) return;
    loadFiles([data]);
    if (hash) scrollToAnchor(hash);
  }

  async function confirmDiscardIfDirty(doc) {
    if (!doc || !doc.isDirty) return true;
    const choice = await window.mdReader.confirmDiscard(docName(doc));
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      if (!doc.path) {
        // Save-as needs UI; switch to the document first
        const docIndex = state.documents.indexOf(doc);
        if (docIndex >= 0 && docIndex !== state.activeIndex) switchDocument(docIndex);
        await saveFileAs();
      } else {
        const result = await window.mdReader.saveFile(doc.path, doc.content);
        if (result && result.success) {
          doc.isDirty = false;
          if (activeDoc() === doc) updateTitle();
          syncSidebar();
        }
      }
      if (doc.isDirty) return false;
    }
    return true;
  }

  function currentContent(doc) {
    return state.mode === 'edit' && state.editorInitialized
      ? window.MDReaderEditor.getContent()
      : doc.content;
  }

  async function saveFile() {
    const doc = activeDoc();
    if (!doc) return;
    if (!doc.path) return saveFileAs();

    const content = currentContent(doc);
    const result = await window.mdReader.saveFile(doc.path, content);
    if (result && result.success) {
      doc.content = content;
      doc.isDirty = false;
      updateTitle();
      syncSidebar();
      showToast(t('saved'));
    }
  }

  async function saveFileAs() {
    const doc = activeDoc();
    if (!doc) return;
    const content = currentContent(doc);
    const result = await window.mdReader.saveFileAs(content);
    if (result && result.success) {
      if (doc.path && doc.path !== result.path) window.mdReader.unwatchFile(doc.path);
      doc.path = result.path;
      doc.content = content;
      doc.isDirty = false;
      window.mdReader.addRecent(result.path);
      updateTitle();
      syncSidebar();
      showToast(t('saved'));
    }
  }

  function updateTitle() {
    const doc = activeDoc();
    if (!doc) {
      window.mdReader.setWindowTitle('MD reader');
      return;
    }
    const title = docName(doc) + (doc.isDirty ? ' *' : '');
    fileTitle.textContent = title;
    fileTitle.title = doc.path || '';
    window.mdReader.setWindowTitle(title + ' - MD reader');
  }

  // ---- External file changes ----

  async function handleFileChanged({ path: changedPath }) {
    const doc = state.documents.find((d) => d.path === changedPath);
    if (!doc || doc.reloadPrompt) return;
    const fileName = window.mdReader.basename(changedPath);

    if (doc.isDirty || (doc === activeDoc() && state.mode === 'edit' && isEditorAhead(doc))) {
      doc.reloadPrompt = true;
      try {
        if ((await window.mdReader.confirmReload(fileName)) !== 'reload') return;
      } finally {
        doc.reloadPrompt = false;
      }
    }
    if (await reloadDocFromDisk(doc)) showToast(t('reloaded', { name: fileName }));
  }

  function isEditorAhead(doc) {
    return state.editorInitialized && window.MDReaderEditor.getContent() !== doc.content;
  }

  async function reloadDocFromDisk(doc) {
    const data = await window.mdReader.readFile(doc.path);
    if (!data || !state.documents.includes(doc)) return false;
    doc.content = data.content;
    doc.isDirty = false;
    if (doc === activeDoc()) {
      const scrollTop = previewPane.scrollTop;
      displayActiveDocument();
      previewPane.scrollTop = scrollTop; // keep the reading position on reload
    }
    syncSidebar();
    return true;
  }

  // ---- Mode Switching ----

  let editorLoad = null;

  /** The CodeMirror bundle is ~600 KB; load it only when editing starts. */
  function loadEditorBundle() {
    if (!editorLoad) {
      editorLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'dist/editor.js';
        script.onload = resolve;
        script.onerror = () => {
          editorLoad = null;
          reject(new Error('editor bundle failed to load'));
        };
        document.head.appendChild(script);
      });
    }
    return editorLoad;
  }

  function enterEditor(anchorLine) {
    const doc = activeDoc();
    if (!doc || state.mode !== 'edit') return;
    if (!state.editorInitialized) initEditor();
    suppressOnChange = true;
    window.MDReaderEditor.setContent(doc.content);
    suppressOnChange = false;

    // Start the editor where the reader was, then re-pin both panes once the
    // split-pane transition has settled (wrapped line heights change with width).
    lockSync(MODE_TRANSITION_MS + 80);
    window.MDReaderEditor.scrollToLine(anchorLine + 1);
    setTimeout(() => {
      if (state.mode !== 'edit' || activeDoc() !== doc) return;
      lockSync(80);
      window.MDReaderEditor.scrollToLine(anchorLine + 1);
      alignPreviewToLine(anchorLine);
      window.MDReaderEditor.focus();
    }, MODE_TRANSITION_MS);
  }

  function setMode(mode) {
    const editing = mode === 'edit';
    // Measure before the layout starts changing.
    const anchorLine = editing ? previewTopLine() : 0;
    state.mode = mode;
    appContainer.classList.toggle('edit-mode', editing);
    modeToggle.classList.toggle('editing', editing);
    modeLabel.textContent = t(editing ? 'read' : 'edit');

    if (editing) {
      closeSearch();
      if (window.MDReaderEditor) {
        enterEditor(anchorLine);
      } else {
        loadEditorBundle()
          .then(() => enterEditor(anchorLine))
          .catch((err) => console.error(err));
      }
    } else {
      // Drop the dragged split width; it is re-chosen per edit session
      editorPane.style.flexBasis = '';
      editorPane.style.width = '';
      renderPreview();
    }
  }

  function toggleMode() {
    const doc = activeDoc();
    if (!doc) return;
    if (state.mode === 'edit') {
      const anchorLine = state.editorInitialized ? window.MDReaderEditor.lineAtScrollTop(editorScrollTop()) - 1 : 0;
      saveEditorContentToDocument();
      setMode('read');
      lockSync(MODE_TRANSITION_MS + 80);
      alignPreviewToLine(anchorLine);
      setTimeout(() => {
        if (state.mode === 'read' && activeDoc() === doc) alignPreviewToLine(anchorLine);
      }, MODE_TRANSITION_MS);
    } else {
      setMode('edit');
    }
    collapseSidebar();
  }

  // ---- Editor Init ----

  function editorScroller() {
    return editorContainer.querySelector('.cm-scroller');
  }

  function editorScrollTop() {
    const scroller = editorScroller();
    return scroller ? scroller.scrollTop : 0;
  }

  /**
   * Anchor-based scroll sync between the source editor and the live preview.
   * Instead of mapping by scroll-height ratio (which breaks with tables —
   * small source, tall rendered output), we align on SOURCE LINE anchors:
   * every block element in the preview carries data-source-line.
   */
  function bindScrollSync() {
    const scroller = editorScroller();
    if (!scroller) return;
    let rafL = null;
    let rafR = null;

    scroller.addEventListener('scroll', () => {
      if (syncLocked() || state.mode !== 'edit' || rafL) return;
      rafL = requestAnimationFrame(() => {
        rafL = null;
        if (syncLocked() || state.mode !== 'edit') return;
        // Editor lines are 1-based; preview data-source-line is 0-based.
        alignPreviewToLine(window.MDReaderEditor.lineAtScrollTop(scroller.scrollTop) - 1);
      });
    });

    previewPane.addEventListener('scroll', () => {
      if (syncLocked() || state.mode !== 'edit' || rafR) return;
      rafR = requestAnimationFrame(() => {
        rafR = null;
        if (syncLocked() || state.mode !== 'edit') return;
        lockSync(60);
        window.MDReaderEditor.scrollToLine(previewTopLine() + 1);
      });
    });
  }

  function initEditor() {
    const debouncedPreview = debounce((content, version) => {
      if (suppressOnChange || version !== state.docVersion) return; // stale after a switch
      const doc = activeDoc();
      if (!doc) return;
      if (doc.content !== content) {
        doc.content = content;
        doc.isDirty = true;
      }
      updateTitle();
      renderPreview();
      patchSidebarDocument(doc);
    }, 200);

    window.MDReaderEditor.init(editorContainer, (content) => {
      debouncedPreview(content, state.docVersion);
    });
    state.editorInitialized = true;
    bindScrollSync();
  }

  // ---- Read-mode Search ----

  function openSearch() {
    if (state.activeIndex < 0 || state.mode !== 'read') return;
    state.search.open = true;
    searchBar.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
    highlightSearch(searchInput.value);
  }

  function closeSearch() {
    state.search.open = false;
    searchBar.style.display = 'none';
    clearSearchHighlights();
    searchCount.textContent = '';
  }

  function toggleSearch() {
    if (state.search.open) closeSearch();
    else openSearch();
  }

  function clearSearchHighlights() {
    previewContent.querySelectorAll('mark.search-hit').forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function highlightSearch(term) {
    clearSearchHighlights();
    if (!term) {
      searchCount.textContent = '';
      return;
    }

    const walker = document.createTreeWalker(previewContent, NodeFilter.SHOW_TEXT);
    const rangesByNode = new Map(); // textNode -> [{start,end}]
    const lowerTerm = term.toLowerCase();

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent) continue;
      const parentEl = node.parentElement;
      if (parentEl && parentEl.closest('pre')) continue; // skip code blocks

      const lower = node.textContent.toLowerCase();
      let idx = 0;
      while ((idx = lower.indexOf(lowerTerm, idx)) !== -1) {
        if (!rangesByNode.has(node)) rangesByNode.set(node, []);
        rangesByNode.get(node).push({ start: idx, end: idx + lowerTerm.length });
        idx += lowerTerm.length;
      }
    }

    // Rewrite each affected text node once (safe against node invalidation)
    rangesByNode.forEach((ranges, node) => {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      let pos = 0;
      ranges.forEach((r) => {
        if (r.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, r.start)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(r.start, r.end);
        frag.appendChild(mark);
        pos = r.end;
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });

    focusMatch(0);
  }

  function focusMatch(index) {
    const marks = previewContent.querySelectorAll('mark.search-hit');
    if (marks.length === 0) {
      searchCount.textContent = t('noResults');
      return;
    }
    const idx = (index + marks.length) % marks.length;
    marks.forEach((m, i) => m.classList.toggle('current', i === idx));
    marks[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    searchCount.textContent = `${idx + 1}/${marks.length}`;
  }

  function navigateSearch(dir) {
    const marks = Array.from(previewContent.querySelectorAll('mark.search-hit'));
    if (marks.length === 0) return;
    const current = Math.max(0, marks.findIndex((m) => m.classList.contains('current')));
    focusMatch(current + dir);
  }

  function reapplySearch() {
    if (state.search.open) highlightSearch(searchInput.value);
  }

  // ---- Welcome: recent files ----

  function renderRecent(recent) {
    while (recentList.firstChild) recentList.removeChild(recentList.firstChild);
    (recent || []).slice(0, 6).forEach((filePath) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'welcome-recent-item';
      item.title = filePath;
      const name = document.createElement('span');
      name.className = 'welcome-recent-name';
      name.textContent = window.mdReader.basename(filePath);
      const dir = document.createElement('span');
      dir.className = 'welcome-recent-dir';
      dir.textContent = filePath.slice(0, filePath.length - name.textContent.length - 1);
      item.append(name, dir);
      item.addEventListener('click', () => openPath(filePath));
      recentList.appendChild(item);
    });
    recentSection.style.display = recentList.firstChild ? '' : 'none';
  }

  // ---- Settings (rendering switches + recent list) ----

  let renderSettings = null;

  function applySettings(settings) {
    if (!settings) return;
    renderRecent(settings.recent);
    const next = `${settings.breaks}|${settings.typographer}`;
    if (next === renderSettings) return;
    renderSettings = next;
    window.MDReaderPreview.configure({
      breaks: settings.breaks,
      typographer: settings.typographer,
      labels: previewLabels(),
    });
    renderOptionsVersion += 1;
    if (activeDoc()) {
      const scrollTop = previewPane.scrollTop;
      renderPreview();
      previewPane.scrollTop = scrollTop;
    }
  }

  function previewLabels() {
    return {
      copy: t('copy'),
      copied: t('copied'),
      frontMatterLabel: t('frontMatter'),
      alertLabels: {
        note: t('note'),
        tip: t('tip'),
        important: t('important'),
        warning: t('warning'),
        caution: t('caution'),
      },
    };
  }

  // ---- Drag & Drop ----

  function setupDragDrop() {
    let dropOverlay = null;

    function removeDropOverlay() {
      if (dropOverlay) {
        dropOverlay.remove();
        dropOverlay = null;
      }
    }

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dropOverlay) {
        dropOverlay = document.createElement('div');
        dropOverlay.className = 'drop-overlay';
        const text = document.createElement('span');
        text.className = 'drop-overlay-text';
        text.textContent = t('dropHere');
        dropOverlay.appendChild(text);
        document.body.appendChild(dropOverlay);
      }
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        removeDropOverlay();
      }
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeDropOverlay();

      const paths = Array.from(e.dataTransfer.files || [])
        .map((f) => window.mdReader.pathForFile(f))
        .filter((p) => /\.(md|markdown|mdown)$/i.test(p || ''));
      const dataList = [];
      for (const filePath of paths) {
        const data = await window.mdReader.readFile(filePath);
        if (data) dataList.push(data);
      }
      if (dataList.length > 0) loadFiles(dataList);
    });
  }

  // ---- Divider drag (edit-mode split resize) ----

  function setupDividerDrag() {
    let dragging = false;

    divider.addEventListener('mousedown', (e) => {
      if (state.mode !== 'edit') return;
      dragging = true;
      e.preventDefault();
      document.body.classList.add('resizing');
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = mainContent.getBoundingClientRect();
      const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      editorPane.style.flexBasis = ratio * 100 + '%';
      editorPane.style.width = ratio * 100 + '%';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
    });
  }

  // ---- Event Listeners ----

  function setupListeners() {
    modeToggle.addEventListener('click', toggleMode);
    themeToggle.addEventListener('click', () => window.MDReaderTheme.toggle());
    openFileBtn.addEventListener('click', openFile);
    searchToggle.addEventListener('click', toggleSearch);
    sidebarToggle.addEventListener('click', toggleSidebar);
    outlineToggle.addEventListener('click', toggleOutline);
    outlineList.addEventListener('click', (e) => {
      const source = e.target && e.target.closest ? e.target : e.target && e.target.parentElement;
      const button = source && source.closest('.outline-item');
      if (!button) return;
      const index = outlineEntries.findIndex((entry) => entry.button === button);
      if (index >= 0) activateOutlineEntry(index);
    });
    previewPane.addEventListener('scroll', onPreviewScrollForOutline);
    previewContent.addEventListener('md-anchor', (e) => scrollToAnchor(e.detail.id));
    previewContent.addEventListener('md-open', (e) => openPath(e.detail.path, e.detail.hash));
    mainContent.addEventListener('mousedown', () => {
      if (sidebarCollapsed || state.documents.length === 0) return;
      collapseSidebar();
    }, true);

    searchInput.addEventListener('input', () => highlightSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        searchToggle.focus();
      }
    });
    searchNext.addEventListener('click', () => navigateSearch(1));
    searchPrev.addEventListener('click', () => navigateSearch(-1));
    searchClose.addEventListener('click', closeSearch);

    window.mdReader.onFileOpened((data) => loadFiles([data]));
    window.mdReader.onFileChanged(handleFileChanged);
    window.mdReader.onSettingsChanged(applySettings);
    window.mdReader.onMenuAction((data) => {
      switch (data && data.action) {
        case 'new':
          newDocument();
          break;
        case 'open':
          openFile();
          break;
        case 'save':
          saveFile();
          break;
        case 'save-as':
          saveFileAs();
          break;
        case 'toggle-mode':
          toggleMode();
          break;
        case 'toggle-sidebar':
          toggleSidebar();
          break;
        case 'toggle-outline':
          toggleOutline();
          break;
        case 'close-document':
          closeActiveDocument();
          break;
      }
    });

    // Cmd/Ctrl+F opens read-mode search; in edit mode CodeMirror owns it.
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && state.mode === 'read' && state.activeIndex >= 0) {
        e.preventDefault();
        openSearch();
      }
    });
  }

  // ---- Init ----

  function init() {
    window.MDReaderI18n.apply(document);
    window.MDReaderPreview.configure({ labels: previewLabels() });
    applySidebarState();
    applyOutlineState();
    setupListeners();
    setupDragDrop();
    setupDividerDrag();
    window.mdReader.getSettings().then(applySettings);

    window.mdReader.onBeforeClose(async () => {
      if (await hasUnsavedChangesAndConfirm()) window.mdReader.confirmClose();
      else window.mdReader.cancelClose();
    });

    // Last: main replays files queued before the renderer was ready.
    window.mdReader.notifyRendererReady();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
