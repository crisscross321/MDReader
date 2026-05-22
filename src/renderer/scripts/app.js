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
  };

  // DOM elements
  const appContainer = document.getElementById('appContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const sidebar = document.getElementById('sidebar');
  const documentsList = document.getElementById('documentsList');
  const editorPane = document.getElementById('editorPane');
  const previewPane = document.getElementById('previewPane');
  const previewContent = document.getElementById('previewContent');
  const editorContainer = document.getElementById('editorContainer');
  const modeToggle = document.getElementById('modeToggle');
  const modeLabel = document.getElementById('modeLabel');
  const modeIcon = document.getElementById('modeIcon');
  const themeToggle = document.getElementById('themeToggle');
  const fileTitle = document.getElementById('fileTitle');
  const openFileBtn = document.getElementById('openFileBtn');

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

  // Flag to suppress editor onChange during programmatic setContent
  let suppressOnChange = false;

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

      const fileName = doc.path ? doc.path.split('/').pop() : 'Untitled';
      const time = new Date(doc.openedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const lines = doc.content.split('\n');
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

    // Dedup by path
    const existingIndex = state.documents.findIndex((d) => d.path === data.path);
    if (existingIndex >= 0) {
      switchDocument(existingIndex);
      return;
    }

    // Save current doc state
    saveCurrentDocState();

    // Add new document
    state.documents.push({
      path: data.path,
      content: data.content,
      isDirty: false,
      openedAt: Date.now(),
    });
    state.activeIndex = state.documents.length - 1;

    // Show UI
    welcomeScreen.style.display = 'none';
    previewPane.style.display = '';
    modeToggle.style.display = '';
    sidebar.classList.add('visible');

    // Reset to read mode for new document
    setMode('read');
    displayActiveDocument();
    renderSidebar();
  }

  function switchDocument(index) {
    if (index === state.activeIndex) return;
    if (index < 0 || index >= state.documents.length) return;

    saveCurrentDocState();
    state.activeIndex = index;
    setMode('read');
    displayActiveDocument();
    renderSidebar();
  }

  function closeDocument(index) {
    if (index < 0 || index >= state.documents.length) return;

    state.documents.splice(index, 1);

    if (state.documents.length === 0) {
      state.activeIndex = -1;
      welcomeScreen.style.display = '';
      previewPane.style.display = 'none';
      modeToggle.style.display = 'none';
      sidebar.classList.remove('visible');
      fileTitle.textContent = 'MD reader';
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

  function saveCurrentDocState() {
    if (state.activeIndex < 0 || state.activeIndex >= state.documents.length) return;
    saveEditorContentToDocument();
  }

  function displayActiveDocument() {
    if (state.activeIndex < 0) return;
    const doc = state.documents[state.activeIndex];

    const fileName = doc.path ? doc.path.split('/').pop() : 'Untitled';
    const dirty = doc.isDirty ? ' *' : '';
    fileTitle.textContent = fileName + dirty;

    window.MDReaderPreview.updatePreview(doc.content, previewContent);

    if (state.editorInitialized) {
      suppressOnChange = true;
      window.MDReaderEditor.setContent(doc.content);
      suppressOnChange = false;
      syncEditorDocumentIndex();
    }
  }

  // ---- File Operations ----

  async function openFile() {
    const data = await window.mdReader.openFile();
    if (data) {
      loadFile(data);
    }
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
    }
  }

  function updateTitle() {
    if (state.activeIndex < 0) return;
    const doc = state.documents[state.activeIndex];
    const fileName = doc.path ? doc.path.split('/').pop() : 'Untitled';
    const dirty = doc.isDirty ? ' *' : '';
    fileTitle.textContent = fileName + dirty;
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

      setTimeout(() => window.MDReaderEditor.focus(), 350);
    } else {
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
          previewContent
        );
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

  function initEditor() {
    const debouncedPreview = debounce((content, documentIndex) => {
      if (suppressOnChange) return;
      if (documentIndex >= 0 && documentIndex < state.documents.length) {
        const doc = state.documents[documentIndex];
        const hasChanged = doc.content !== content;

        doc.content = content;
        if (hasChanged) {
          doc.isDirty = true;
        }

        if (documentIndex === state.activeIndex) {
          updateTitle();
          window.MDReaderPreview.updatePreview(content, previewContent);
        }

        renderSidebar();
      }
    }, 200);

    window.MDReaderEditor.init(editorContainer, (content) => {
      debouncedPreview(content, state.editorDocumentIndex);
    });
    if (state.activeIndex >= 0) {
      syncEditorDocumentIndex();
      window.MDReaderEditor.setContent(state.documents[state.activeIndex].content);
    }
    state.editorInitialized = true;
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

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        const filePath = file.path;
        if (
          filePath.endsWith('.md') ||
          filePath.endsWith('.markdown') ||
          filePath.endsWith('.mdown')
        ) {
          const data = await window.mdReader.readFile(filePath);
          if (data) loadFile(data);
        }
      }
    });

    function removeDropOverlay() {
      if (dropOverlay) {
        dropOverlay.remove();
        dropOverlay = null;
      }
    }
  }

  // ---- Event Listeners ----

  function setupListeners() {
    modeToggle.addEventListener('click', toggleMode);
    themeToggle.addEventListener('click', () => window.MDReaderTheme.toggle());
    openFileBtn.addEventListener('click', openFile);

    window.mdReader.onFileOpened(loadFile);
    window.mdReader.onMenuAction((action) => {
      switch (action) {
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
        case 'toggle-theme':
          window.MDReaderTheme.toggle();
          break;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key === 'e') {
        e.preventDefault();
        toggleMode();
      }
      if (e.metaKey && e.shiftKey && e.key === 't') {
        e.preventDefault();
        window.MDReaderTheme.toggle();
      }
    });
  }

  // ---- Init ----

  function init() {
    window.MDReaderTheme.init();
    setupListeners();
    setupDragDrop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
