/* ==========================================
   MD reader — Preview Renderer (markdown-it + highlight.js)
   ========================================== */

(function () {
  const markdownIt = require('markdown-it');
  const hljs = require('highlight.js');
  const { shell } = require('electron');

  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            '<pre class="hljs"><code>' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true })
              .value +
            '</code></pre>'
          );
        } catch (_) {
          /* ignore */
        }
      }
      return (
        '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>'
      );
    },
  });

  // Enable GFM-like features
  md.enable(['table', 'strikethrough']);

  // Task list plugin (inline)
  md.core.ruler.after('inline', 'task-list', function (state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      const content = tokens[i].content;
      if (/^\[([ xX])\]\s/.test(content)) {
        const checked = content[1] !== ' ';
        const checkbox = checked
          ? '<input type="checkbox" checked disabled> '
          : '<input type="checkbox" disabled> ';
        tokens[i].content = content.replace(/^\[([ xX])\]\s/, '');
        tokens[i].children[0].content = tokens[i].content;

        // Prepend checkbox token
        const token = new state.Token('html_inline', '', 0);
        token.content = checkbox;
        tokens[i].children.unshift(token);
      }
    }
  });

  /**
   * Render markdown string to HTML
   * @param {string} markdownString
   * @returns {string} rendered HTML
   */
  function render(markdownString) {
    return md.render(markdownString || '');
  }

  /**
   * Update the preview container with rendered markdown
   * @param {string} markdownString
   * @param {HTMLElement} container
   */
  function updatePreview(markdownString, container) {
    if (!container) return;
    container.innerHTML = render(markdownString);

    // Make external links open in default browser
    const links = container.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          shell.openExternal(href);
        });
      }
    });
  }

  // Export to window
  window.MDReaderPreview = { render, updatePreview };
})();
