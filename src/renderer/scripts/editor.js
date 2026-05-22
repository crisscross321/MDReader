/* ==========================================
   MD reader — CodeMirror 6 Editor Wrapper
   ========================================== */

(function () {
  let editorView = null;
  let onChangeCallback = null;
  let editorReady = false;

  /**
   * Initialize the CodeMirror editor
   * @param {HTMLElement} container
   * @param {Function} onChange - called with new content string
   */
  function init(container, onChange) {
    try {
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
            fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
            fontSize: '14px',
            lineHeight: '1.7',
            padding: '24px 20px',
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

      const state = EditorState.create({
        doc: '',
        extensions: [
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
        ],
      });

      editorView = new EditorView({
        state,
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
   * Set the editor content
   * @param {string} text
   */
  function setContent(text) {
    if (!editorView) return;
    const transaction = editorView.state.update({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: text,
      },
    });
    editorView.dispatch(transaction);
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
  window.MDReaderEditor = { init, setContent, getContent, focus, isReady };
})();
