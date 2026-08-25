/* ==========================================
   MD reader — App Controller (Multi-Document)
   ========================================== */

(function () {
  // State
  const state = {
    mode: 'read', // 'read' or 'edit'
    documents: [], // [{path, content, isDirty, openedAt}]
    activeIndex: -1,
    editorDocumentIndex: -1,
    editorInitialized: false,
    docVersion: 0, // bumped on doc switch/close — invalidates pending debounce
    search: { open: false },
  };

  // DOM elements
  const appContainer = document.getElementById('appContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const sidebar = document.getElementById('sidebar');
  const documentsList = document.getElementById('documentsList');
  const editorPane = document.getElementById('editorPane');
  const divider = document.getElementById('divider');
  const previewPane = document.getElementById('previewPane');
  const previewContent = document.getElementById('previewContent');
  const editorContainer = document.getElementById('editorContainer');
  const modeToggle = document.getElementById('modeToggle');
  const modeLabel = document.getElementById('modeLabel');
  const modeIcon = document.getElementById('modeIcon');
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

  // Debounce helper
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

  // Flag to suppress editor onChange during programmatic setContent
  let suppressOnChange = false;
  let closeConfirmationInFlight = false;

  function saveEditorContentToDocument(index = state.activeIndex) {
    if (!state.editorInitialized || state.mode !== 'edit') return;
    if (index < 0 || index >= state.documents.length) return;

    const content = window.MDReaderEditor.getContent();
    if (state.documents[index].content !== content) {
      state.documents[index].content = content;
      state.documents[index].isDirty = true;
    }
  }

  function syncEditorDocumentIndex() {
    state.editorDocumentIndex = state.mode === 'edit' ? state.activeIndex : -1;
  }

  // ---- Sidebar Rendering ----

  function renderSidebar() {
    documentsList.innerHTML = '';
    state.documents.forEach((doc, index) => {
      const item = document.createElement('div');
      item.className = 'doc-item' +
        (index === state.activeIndex ? ' active' : '') +
        (doc.isDirty ? ' dirty' : '');
      item.dataset.index = index;

      const fileName = doc.path
        ? window.mdReader.basename(doc.path)
        : 'Untitled';
      const time = new Date(doc.openedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      // Only scan the head of the document for the snippet — O(1) per doc
      const lines = doc.content.slice(0, 1500).split('\n');
      const previewLine = lines.find((l) => l.trim() && !l.startsWith('#')) || '';
      const snippet = previewLine.substring(0, 30).trim() || '';

      item.innerHTML = `
        <span class="doc-item-dirty"></span>
        <div class="doc-item-info">
          <div class="doc-item-name">${escapeHtml(fileName)}</div>
          <div class="doc-item-meta">${time}${snippet ? ' &nbsp; ' + escapeHtml(snippet) : ''}</div>
        </div>
        <button class="doc-item-close" data-close-index="${index}" title="Close">&times;</button>
      `;

      documentsList.appendChild(item);
    });
  }

  // Event delegation for sidebar clicks (survives DOM rebuild)
  documentsList.addEventListener('click', (e) => {
    // Close button
    const closeBtn = e.target.closest('[data-close-index]');
    if (closeBtn) {
      e.stopPropagation();
      const idx = parseInt(closeBtn.dataset.closeIndex, 10);
      closeDocument(idx);
      return;
    }
    // Item click → switch document
    const item = e.target.closest('.doc-item');
    if (item && item.dataset.index !== undefined) {
      const idx = parseInt(item.dataset.index, 10);
      switchDocument(idx);
    }
  });

  // ---- Document Management ----

  function loadFile(data) {
    if (!data) return;
    loadFiles([data]);
  }

  function loadFiles(dataList) {
    if (!Array.isArray(dataList) || dataList.length === 0) return;

    saveCurrentDocState();

    let lastIndex = -1;
    let addedAny = false;
    for (const data of dataList) {
      if (!data) continue;

      const existingIndex = state.documents.findIndex((d) => d.path === data.path);
      if (existingIndex >= 0) {
        lastIndex = existingIndex;
        continue;
      }

      state.documents.push({
        path: data.path,
        content: data.content,
        isDirty: false,
        openedAt: Date.now(),
      });
      lastIndex = state.documents.length - 1;
      addedAny = true;
    }

    if (lastIndex < 0) return;
    if (!addedAny && lastIndex === state.activeIndex) return;

    state.activeIndex = lastIndex;
    state.docVersion += 1;

    showDocumentUI();
    setMode('read');
    displayActiveDocument();
    renderSidebar();
  }

  function showDocumentUI() {
    welcomeScreen.style.display = 'none';
    previewPane.style.display = '';
    modeToggle.style.display = '';
    searchToggle.style.display = '';
    sidebar.classList.add('visible');
  }

  function switchDocument(index) {
    if (index === state.activeIndex) return;
    if (index < 0 || index >= state.documents.length) return;

    saveCurrentDocState();
    state.activeIndex = index;
    state.docVersion += 1;
    setMode('read');
    displayActiveDocument();
    renderSidebar();
  }

  async function closeDocument(index) {
    if (index < 0 || index >= state.documents.length) return;

    const doc = state.documents[index];
    // Save current editor content into state before checking dirty flag
    if (index === state.activeIndex) {
      saveCurrentDocState();
    }
    const ok = await confirmDiscardIfDirty(doc);
    if (!ok) return;

    if (doc.path) {
      window.mdReader.unwatchFile(doc.path);
    }
    state.documents.splice(index, 1);
    state.docVersion += 1;

    if (state.documents.length === 0) {
      state.activeIndex = -1;
      closeSearch();
      welcomeScreen.style.display = '';
      previewPane.style.display = 'none';
      modeToggle.style.display = 'none';
      searchToggle.style.display = 'none';
      sidebar.classList.remove('visible');
      fileTitle.textContent = 'MD reader';
      window.mdReader.setWindowTitle('MD reader');
      previewContent.innerHTML = '';
      appContainer.classList.remove('edit-mode');
      renderSidebar();
      return;
    }

    if (index === state.activeIndex) {
      state.activeIndex = Math.min(index, state.documents.length - 1);
      setMode('read');
      displayActiveDocument();
    } else if (index < state.activeIndex) {
      state.activeIndex--;
    }

    renderSidebar();
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
      const dirtyDocs = state.documents.filter((d) => d.isDirty);
      for (const doc of dirtyDocs) {
        const ok = await confirmDiscardIfDirty(doc);
        if (!ok) return false;
      }
      return true;
    } finally {
      closeConfirmationInFlight = false;
    }
  }

  function saveCurrentDocState() {
    if (state.activeIndex < 0 || state.activeIndex >= state.documents.length) return;
    saveEditorContentToDocument();
  }

  function displayActiveDocument() {
    if (state.activeIndex < 0) return;
    const doc = state.documents[state.activeIndex];

    updateTitle();
    window.MDReaderPreview.updatePreview(doc.content, previewContent, doc.path);

    if (state.editorInitialized) {
      suppressOnChange = true;
      window.MDReaderEditor.setContent(doc.content);
      suppressOnChange = false;
      syncEditorDocumentIndex();
    }

    reapplySearch();
  }

  // ---- File Operations ----

  function newDocument() {
    saveCurrentDocState();

    state.documents.push({
      path: null,
      content: '',
      isDirty: false,
      openedAt: Date.now(),
    });
    state.activeIndex = state.documents.length - 1;
    state.docVersion += 1;

    showDocumentUI();
    setMode('read');
    displayActiveDocument();
    renderSidebar();
  }

  async function openFile() {
    const result = await window.mdReader.openFile();
    if (!result) return;
    const docs = Array.isArray(result) ? result : [result];
    loadFiles(docs);
  }

  async function openRecent(filePath) {
    if (!filePath) return;
    const data = await window.mdReader.readFile(filePath);
    if (data) loadFiles([data]);
  }

  async function confirmDiscardIfDirty(doc) {
    if (!doc || !doc.isDirty) return true;
    const fileName = doc.path
      ? window.mdReader.basename(doc.path)
      : 'Untitled';
    const choice = await window.mdReader.confirmDiscard(fileName);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      if (!doc.path) {
        // Save-as needs UI; fall back to switching to it
        const docIndex = state.documents.indexOf(doc);
        if (docIndex >= 0 && docIndex !== state.activeIndex) {
          switchDocument(docIndex);
        }
        await saveFileAs();
      } else {
        const result = await window.mdReader.saveFile(doc.path, doc.content);
        if (result && result.success) {
          doc.isDirty = false;
          if (state.documents[state.activeIndex] === doc) updateTitle();
          renderSidebar();
        }
      }
      if (doc.isDirty) return false;
    }
    return true;
  }

  async function saveFile() {
    if (state.activeIndex < 0) return;
    const doc = state.documents[state.activeIndex];
    if (!doc.path) return saveFileAs();

    const content =
      state.mode === 'edit' && state.editorInitialized
        ? window.MDReaderEditor.getContent()
        : doc.content;
    const result = await window.mdReader.saveFile(doc.path, content);
    if (result && result.success) {
      doc.content = content;
      doc.isDirty = false;
      updateTitle();
      renderSidebar();
      showToast('Saved');
    }
  }

  async function saveFileAs() {
    if (state.activeIndex < 0) return;
    const doc = state.documents[state.activeIndex];
    const content =
      state.mode === 'edit' && state.editorInitialized
        ? window.MDReaderEditor.getContent()
        : doc.content;
    const result = await window.mdReader.saveFileAs(content);
    if (result && result.success) {
      doc.path = result.path;
      doc.content = content;
      doc.isDirty = false;
      updateTitle();
      renderSidebar();
      showToast('Saved');
    }
  }

  function updateTitle() {
    if (state.activeIndex < 0) {
      window.mdReader.setWindowTitle('MD reader');
      return;
    }
    const doc = state.documents[state.activeIndex];
    const fileName = doc.path
      ? window.mdReader.basename(doc.path)
      : 'Untitled';
    const dirty = doc.isDirty ? ' *' : '';
    fileTitle.textContent = fileName + dirty;
    window.mdReader.setWindowTitle(fileName + dirty + ' - MD reader');
  }

  // ---- External file changes ----

  function handleFileChanged(changedPath) {
    const docIndex = state.documents.findIndex((d) => d.path === changedPath);
    if (docIndex < 0) return;
    const doc = state.documents[docIndex];
    const fileName = window.mdReader.basename(changedPath);

    if (doc.isDirty) {
      window.mdReader.confirmReload(fileName).then((choice) => {
        if (choice !== 'reload') return;
        reloadDocFromDisk(docIndex);
      });
      return;
    }
    reloadDocFromDisk(docIndex);
    showToast(`"${fileName}" reloaded from disk`);
  }

  async function reloadDocFromDisk(docIndex) {
    const doc = state.documents[docIndex];
    const data = await window.mdReader.readFile(doc.path);
    if (!data) return;
    doc.content = data.content;
    doc.isDirty = false;
    if (docIndex === state.activeIndex) {
      displayActiveDocument();
    }
    renderSidebar();
  }

  // ---- Mode Switching ----

  function setMode(mode) {
    state.mode = mode;

    if (mode === 'edit') {
      appContainer.classList.add('edit-mode');
      syncEditorDocumentIndex();
      modeLabel.textContent = 'Read';
      modeIcon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      `;

      if (!state.editorInitialized) {
        initEditor();
      } else if (state.activeIndex >= 0) {
        suppressOnChange = true;
        window.MDReaderEditor.setContent(state.documents[state.activeIndex].content);
        suppressOnChange = false;
      }

      closeSearch();
      setTimeout(() => window.MDReaderEditor.focus(), 350);
    } else {
      // Restore editor pane width (user's drag preference no longer applies)
      editorPane.style.flexBasis = '';
      editorPane.style.width = '';
      syncEditorDocumentIndex();
      appContainer.classList.remove('edit-mode');
      modeLabel.textContent = 'Edit';
      modeIcon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      if (state.activeIndex >= 0) {
        window.MDReaderPreview.updatePreview(
          state.documents[state.activeIndex].content,
          previewContent,
          state.documents[state.activeIndex].path
        );
        reapplySearch();
      }
    }
  }

  function toggleMode() {
    if (state.activeIndex < 0) return;
    if (state.mode === 'edit') {
      saveEditorContentToDocument();
    }
    setMode(state.mode === 'read' ? 'edit' : 'read');
  }

  // ---- Editor Init ----

  let scrollSyncBound = false;

  /**
   * Anchor-based scroll sync between the source editor (.cm-scroller) and the
   * live preview. Instead of mapping by scroll-height ratio (which breaks with
   * tables — small source, tall rendered output), we align on SOURCE LINE
   * anchors: every block element in the preview carries data-source-line.
   */
  function bindScrollSync() {
    if (scrollSyncBound) return;
    const scroller = editorContainer.querySelector('.cm-scroller');
    if (!scroller) return;

    scrollSyncBound = true;
    let syncing = false;
    let rafL = null;
    let rafR = null;

    function markSyncing() {
      syncing = true;
      setTimeout(() => {
        syncing = false;
      }, 60);
    }

    function findPreviewElForLine(lineNo) {
      const els = previewContent.querySelectorAll('[data-source-line]');
      // DOM order follows source order → last element with line <= lineNo
      let best = null;
      for (const el of els) {
        const l = parseInt(el.getAttribute('data-source-line'), 10);
        if (l <= lineNo) best = el;
        else break;
      }
      return best;
    }

    /**
     * Compute el's offset top relative to a scroll container, walking
     * offsetParent chain — viewport-independent and scroll-safe.
     */
    function offsetTopWithin(el, container) {
      let top = 0;
      let node = el;
      while (node && node !== container && node !== document.body) {
        top += node.offsetTop;
        node = node.offsetParent;
      }
      return top;
    }

    function scrollPreviewToElement(el) {
      previewPane.scrollTop = Math.max(0, offsetTopWithin(el, previewPane) - 16);
    }

    function syncLeftToRight() {
      if (syncing || state.mode !== 'edit') return;
      const topLine = window.MDReaderEditor.lineAtScrollTop(scroller.scrollTop);
      const el = findPreviewElForLine(topLine);
      if (el) {
        markSyncing();
        scrollPreviewToElement(el);
      }
    }

    function findPreviewElAtViewportTop() {
      const els = previewContent.querySelectorAll('[data-source-line]');
      if (els.length === 0) return null;
      const paneRect = previewPane.getBoundingClientRect();
      let best = els[0];
      for (const el of els) {
        const elRect = el.getBoundingClientRect();
        if (elRect.top <= paneRect.top + 24) best = el;
        else break;
      }
      return best;
    }

    function syncRightToLeft() {
      if (syncing || state.mode !== 'edit') return;
      const el = findPreviewElAtViewportTop();
      if (!el) return;
      const lineNo = parseInt(el.getAttribute('data-source-line'), 10);
      if (!Number.isFinite(lineNo)) return;
      markSyncing();
      window.MDReaderEditor.scrollToLine(lineNo);
    }

    scroller.addEventListener('scroll', () => {
      if (syncing || state.mode !== 'edit') return;
      if (rafL) return;
      rafL = requestAnimationFrame(() => {
        rafL = null;
        syncLeftToRight();
      });
    });

    previewPane.addEventListener('scroll', () => {
      if (syncing || state.mode !== 'edit') return;
      if (rafR) return;
      rafR = requestAnimationFrame(() => {
        rafR = null;
        syncRightToLeft();
      });
    });
  }

  function initEditor() {
    const debouncedPreview = debounce((content, documentIndex, version) => {
      if (suppressOnChange) return;
      // Ignore stale callbacks that fired after a document switch
      if (version !== state.docVersion) return;
      if (documentIndex >= 0 && documentIndex < state.documents.length) {
        const doc = state.documents[documentIndex];
        const hasChanged = doc.content !== content;

        doc.content = content;
        if (hasChanged) {
          doc.isDirty = true;
        }

        if (documentIndex === state.activeIndex) {
          updateTitle();
          window.MDReaderPreview.updatePreview(
            content,
            previewContent,
            doc.path
          );
          reapplySearch();
        }

        renderSidebar();
      }
    }, 200);

    window.MDReaderEditor.init(editorContainer, (content) => {
      debouncedPreview(content, state.editorDocumentIndex, state.docVersion);
    });
    if (state.activeIndex >= 0) {
      syncEditorDocumentIndex();
      window.MDReaderEditor.setContent(state.documents[state.activeIndex].content);
    }
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
    const marks = previewContent.querySelectorAll('mark.search-hit');
    marks.forEach((m) => {
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

    const walker = document.createTreeWalker(
      previewContent,
      NodeFilter.SHOW_TEXT
    );
    const rangesByNode = new Map(); // textNode -> [{start,end}]
    const totalMatches = { count: 0 };

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent) continue;
      const parentEl = node.parentElement;
      if (parentEl && parentEl.closest('.hljs, pre')) continue; // skip code blocks

      const text = node.textContent;
      const lower = text.toLowerCase();
      const lowerTerm = term.toLowerCase();
      let idx = 0;
      let first = -1;
      while ((idx = lower.indexOf(lowerTerm, idx)) !== -1) {
        if (first === -1) first = idx;
        if (!rangesByNode.has(node)) rangesByNode.set(node, []);
        rangesByNode.get(node).push({ start: idx, end: idx + term.length });
        totalMatches.count += 1;
        idx += term.length;
      }
      void first;
    }

    // Rewrite each affected text node once (safe against node invalidation)
    rangesByNode.forEach((ranges, node) => {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      let pos = 0;
      ranges.sort((a, b) => a.start - b.start);
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

    updateSearchCount(totalMatches.count);
    scrollToCurrentMatch();
  }

  function updateSearchCount(total) {
    const marks = previewContent.querySelectorAll('mark.search-hit');
    const totalCount = total !== undefined ? total : marks.length;
    if (totalCount === 0) {
      searchCount.textContent = 'No results';
      return;
    }
    const current = getCurrentMatchIndex();
    searchCount.textContent = `${current + 1}/${totalCount}`;
  }

  function getCurrentMatchIndex() {
    const marks = previewContent.querySelectorAll('mark.search-hit');
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].classList.contains('current')) return i;
    }
    return 0;
  }

  function scrollToCurrentMatch() {
    const marks = previewContent.querySelectorAll('mark.search-hit');
    marks.forEach((m) => m.classList.remove('current'));
    if (marks.length === 0) return;
    marks[0].classList.add('current');
    marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function navigateSearch(dir) {
    const marks = previewContent.querySelectorAll('mark.search-hit');
    if (marks.length === 0) return;
    let idx = getCurrentMatchIndex();
    marks[idx].classList.remove('current');
    idx = (idx + dir + marks.length) % marks.length;
    marks[idx].classList.add('current');
    marks[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateSearchCount();
  }

  function reapplySearch() {
    if (state.search.open) {
      highlightSearch(searchInput.value);
    }
  }

  // ---- Drag & Drop ----

  function setupDragDrop() {
    let dropOverlay = null;

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dropOverlay) {
        dropOverlay = document.createElement('div');
        dropOverlay.className = 'drop-overlay';
        dropOverlay.innerHTML =
          '<span class="drop-overlay-text">Drop Markdown file here</span>';
        document.body.appendChild(dropOverlay);
      }
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        removeDropOverlay();
      }
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeDropOverlay();

      const files = Array.from(e.dataTransfer.files || []);
      const mdFiles = files.filter((f) =>
        /\.(md|markdown|mdown)$/i.test(f.path || f.name)
      );
      const dataList = [];
      for (const file of mdFiles) {
        const data = await window.mdReader.readFile(file.path);
        if (data) dataList.push(data);
      }
      if (dataList.length > 0) loadFiles(dataList);
    });

    function removeDropOverlay() {
      if (dropOverlay) {
        dropOverlay.remove();
        dropOverlay = null;
      }
    }
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
      const rect = appContainer.getBoundingClientRect();
      const pct = Math.min(
        0.8,
        Math.max(0.2, (e.clientX - rect.left) / rect.width) * 100
      );
      editorPane.style.flexBasis = pct + '%';
      editorPane.style.width = pct + '%';
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

    window.mdReader.onFileOpened(loadFile);
    window.mdReader.onFileChanged(handleFileChanged);
    window.mdReader.onMenuAction((data) => {
      const action = data && data.action ? data.action : data;
      const payload = data && data.payload;
      switch (action) {
        case 'new':
          newDocument();
          break;
        case 'open':
          openFile();
          break;
        case 'open-recent':
          openRecent(payload);
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
        case 'toggle-theme':
          window.MDReaderTheme.toggle();
          break;
        case 'close-document':
          closeActiveDocument();
          break;
      }
    });

    // Cmd+F opens read-mode search; menu accelerators own Cmd+E / Cmd+Shift+T
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key === 'f') {
        if (state.mode === 'read' && state.activeIndex >= 0) {
          e.preventDefault();
          openSearch();
        }
      }
    });
  }

  // ---- Init ----

  function init() {
    window.MDReaderTheme.init();
    setupListeners();
    setupDragDrop();
    setupDividerDrag();
    window.mdReader.notifyRendererReady();

    window.mdReader.onBeforeClose(async () => {
      const ok = await hasUnsavedChangesAndConfirm();
      if (ok) {
        window.mdReader.confirmClose();
      } else {
        window.mdReader.cancelClose();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
