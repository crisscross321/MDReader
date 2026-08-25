/* ==========================================
   MD reader — CodeMirror 6 Editor Wrapper
   Bundled via esbuild — CodeMirror deps are inlined at build time.
   ========================================== */

(function () {
  // Module-level requires so every exported function (incl. setContent)
  // can access CodeMirror APIs — the old per-init require left
  // EditorState out of scope for setContent, breaking edit mode.
  const {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
  } = require('@codemirror/view');
  const { EditorState } = require('@codemirror/state');
  const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
  const {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } = require('@codemirror/commands');
  const {
    syntaxHighlighting,
    defaultHighlightStyle,
    indentOnInput,
    bracketMatching,
    foldGutter,
    foldKeymap,
  } = require('@codemirror/language');
  const {
    highlightSelectionMatches,
    searchKeymap,
  } = require('@codemirror/search');
  const {
    closeBrackets,
    closeBracketsKeymap,
  } = require('@codemirror/autocomplete');

  let editorView = null;
  let onChangeCallback = null;
  let editorReady = false;
  let extensionsRef = null;

  /**
   * Initialize the CodeMirror editor
   * @param {HTMLElement} container
   * @param {Function} onChange - called with new content string
   */
  function init(container, onChange) {
    try {
      onChangeCallback = onChange;

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeCallback) {
          onChangeCallback(update.state.doc.toString());
        }
      });

      // Light theme
      const lightTheme = EditorView.theme(
        {
          '&': {
            backgroundColor: 'var(--bg-editor)',
            color: 'var(--text-primary)',
          },
          '.cm-content': {
            caretColor: 'var(--text-primary)',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--text-primary)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--bg-editor)',
            color: 'var(--text-muted)',
            border: 'none',
            borderRight: '1px solid var(--border)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(0,0,0,0.02)',
          },
          '.cm-selectionBackground': {
            backgroundColor: 'rgba(74, 144, 217, 0.15) !important',
          },
          '&.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(74, 144, 217, 0.2) !important',
          },
          '.cm-line': {
            padding: '0 4px',
          },
        },
        { dark: false }
      );

      // Keep the extension list so we can rebuild EditorState on doc switch
      // (rebuilding resets undo history — prevents cross-document undo from
      //  reverting the new document back to the previous one's content)
      extensionsRef = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        history(),
        highlightSelectionMatches(),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        lightTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        updateListener,
        EditorView.lineWrapping,
      ];

      editorView = new EditorView({
        state: EditorState.create({ doc: '', extensions: extensionsRef }),
        parent: container,
      });

      editorReady = true;
      console.log('[Editor] initialized successfully');
    } catch (err) {
      console.error('[Editor] Failed to initialize:', err);
      editorReady = false;
    }
  }

  /**
   * Set the editor content.
   * Rebuilds the whole EditorState (resets undo history & scroll) when the
   * text actually differs — i.e. when switching documents. When the content
   * is unchanged (e.g. mode toggling), we short-circuit to preserve
   * selection, scroll position and undo history.
   * @param {string} text
   */
  function setContent(text) {
    if (!editorView) return;
    if (text === editorView.state.doc.toString()) return;

    const newState = EditorState.create({
      doc: text,
      extensions: extensionsRef,
    });
    editorView.setState(newState);
  }

  /**
   * Get the current editor content
   * @returns {string}
   */
  function getContent() {
    if (!editorView) return '';
    return editorView.state.doc.toString();
  }

  /**
   * Get the source line number at a given scroller scrollTop.
   * Used by anchor-based scroll sync (left → right).
   * @param {number} scrollTop
   * @returns {number} 1-based line number
   */
  function lineAtScrollTop(scrollTop) {
    if (!editorView) return 1;
    try {
      const block = editorView.lineBlockAtHeight(scrollTop, -1);
      if (!block) return 1;
      return editorView.state.doc.lineAt(block.from).number;
    } catch (_) {
      return 1;
    }
  }

  /**
   * Scroll the editor so the given source line is at the top of the viewport.
   * Used by anchor-based scroll sync (right → left).
   * @param {number} lineNo 1-based line number
   */
  function scrollToLine(lineNo) {
    if (!editorView) return;
    try {
      const doc = editorView.state.doc;
      const clamped = Math.max(1, Math.min(lineNo, doc.lines));
      const pos = doc.line(clamped).from;
      editorView.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 8 }),
      });
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Focus the editor
   */
  function focus() {
    if (editorView) {
      editorView.focus();
    }
  }

  /**
   * Check if editor is ready
   */
  function isReady() {
    return editorReady;
  }

  // Export to window
  window.MDReaderEditor = {
    init,
    setContent,
    getContent,
    focus,
    isReady,
    lineAtScrollTop,
    scrollToLine,
  };
})();
