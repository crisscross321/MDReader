/* ==========================================
   MD reader — Preview Renderer (markdown-it + highlight.js)
   Bundled via esbuild — node_modules deps are inlined at build time.
   ========================================== */

(function () {
  const markdownIt = require('markdown-it');
  const hljs = require('highlight.js/lib/core');

  // ---- Highlight.js: register common languages only (shrink bundle) ----
  const languages = {
    javascript: require('highlight.js/lib/languages/javascript'),
    typescript: require('highlight.js/lib/languages/typescript'),
    json: require('highlight.js/lib/languages/json'),
    xml: require('highlight.js/lib/languages/xml'),
    css: require('highlight.js/lib/languages/css'),
    python: require('highlight.js/lib/languages/python'),
    bash: require('highlight.js/lib/languages/bash'),
    markdown: require('highlight.js/lib/languages/markdown'),
    c: require('highlight.js/lib/languages/c'),
    cpp: require('highlight.js/lib/languages/cpp'),
    java: require('highlight.js/lib/languages/java'),
    go: require('highlight.js/lib/languages/go'),
    rust: require('highlight.js/lib/languages/rust'),
    sql: require('highlight.js/lib/languages/sql'),
    yaml: require('highlight.js/lib/languages/yaml'),
    diff: require('highlight.js/lib/languages/diff'),
    ini: require('highlight.js/lib/languages/ini'),
  };
  Object.keys(languages).forEach((name) =>
    hljs.registerLanguage(name, languages[name])
  );

  const md = markdownIt({
    html: true,
    linkify: true,
    // typographer 保持开启：中文剪藏内容受益于弯引号/破折号排版
    typographer: true,
    breaks: true,
    highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            '<pre class="hljs"><code class="language-' + lang + '">' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true })
              .value +
            '</code></pre>'
          );
        } catch (_) {
          /* fall through */
        }
      }
      return (
        '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>'
      );
    },
  });

  // Enable GFM-like features
  md.enable(['table', 'strikethrough']);

  // ---- Task list (proper GFM: "- [ ]", "* [ ]", "+ [ ]", nested) ----
  // markdown-it structure for a list item paragraph:
  //   bullet_list_open -> list_item_open -> paragraph_open -> inline -> ...
  // We patch the inline token that is the first paragraph of a list item.
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

      // The original leading text token still holds "[x] ..." — rewrite it
      const textToken = token.children.find((c) => c.type === 'text');
      if (textToken) {
        textToken.content = rest;
      }
    }
  });

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
    while (index < lines.length && isSkippableTableGap(lines[index])) {
      index += 1;
    }

    return {
      index,
      line: index < lines.length ? lines[index] : null,
      skipped: index > startIndex,
    };
  }

  /**
   * Normalize table gaps (blank lines / HTML comments inside tables).
   * Returns { text, map } where map[i] = original source line number of
   * normalized line i — needed to keep anchor-based scroll sync accurate
   * when normalization shifts line numbers.
   */
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
          const {
            index: lookahead,
            line: candidate,
            skipped,
          } = nextMeaningfulLine(lines, i + 1);

          if (candidate === null) {
            i = lines.length;
            break;
          }

          if (!isTableRow(candidate)) {
            if (skipped) {
              normalized.push('');
              map.push(i + 1); // first skipped line
            }
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

  // Anchor lines: tag block-level tokens with data-source-line so the
  // preview can be scrolled to match the source editor (and vice versa).
  md.core.ruler.push('source-line', function (state) {
    const map = state.env.offsetMap;
    if (!map) return;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token.map) continue;
      const isBlockOpen = token.type.endsWith('_open');
      const isSelfClose =
        token.type === 'hr' ||
        token.type === 'fence' ||
        token.type === 'code_block';
      if (!isBlockOpen && !isSelfClose) continue;
      const origLine = map[token.map[0]];
      if (origLine !== undefined) {
        token.attrSet('data-source-line', String(origLine));
      }
    }
  });

  // ---- Sanitize: strip dangerous elements/attributes (defense in depth
  //      behind CSP — script-src 'self' already blocks inline scripts) ----
  function sanitizeDOM(root) {
    const REMOVE_TAGS = new Set([
      'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'style', 'form',
    ]);
    const all = root.querySelectorAll('*');
    const toRemove = [];
    const toClean = [];

    all.forEach((el) => {
      if (REMOVE_TAGS.has(el.tagName.toLowerCase())) {
        toRemove.push(el);
        return;
      }
      // Keep only disabled checkboxes (task lists); drop other inputs
      if (el.tagName.toLowerCase() === 'input') {
        if (el.type !== 'checkbox' || !el.disabled) {
          toRemove.push(el);
          return;
        }
      }
      toClean.push(el);
    });

    toRemove.forEach((el) => el.remove());

    toClean.forEach((el) => {
      const attrs = Array.from(el.attributes || []);
      attrs.forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === 'href' || name === 'src') {
          const val = (attr.value || '').trim().toLowerCase();
          if (val.startsWith('javascript:')) {
            el.removeAttribute(attr.name);
          }
        }
      });
    });
  }

  // ---- Resolve relative resources against the document directory ----
  function resolveLocalResources(root, docPath) {
    if (!window.mdReader || !docPath) return;

    const imgs = root.querySelectorAll('img[src]');
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|file:|data:)/i.test(src)) return;
      const resolved = window.mdReader.resolveFileUrl(docPath, src);
      if (resolved) img.setAttribute('src', resolved.url);
    });

    const links = root.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || /^(https?:|mailto:|#)/i.test(href)) return;
      const clean = href.split('?')[0].split('#')[0];
      const isMd = /\.(md|markdown|mdown)$/i.test(clean);
      const resolved = window.mdReader.resolveFileUrl(docPath, href);
      if (resolved) {
        link.dataset.localResolved = JSON.stringify({
          path: resolved.path,
          url: resolved.url,
          md: isMd,
        });
      }
    });
  }

  let boundContainer = null;

  function bindContainerClick(container) {
    if (boundContainer === container) return;
    boundContainer = container;
    container.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || !window.mdReader) return;
      const href = a.getAttribute('href');

      if (/^https?:/i.test(href)) {
        e.preventDefault();
        window.mdReader.openExternal(href);
        return;
      }

      const local = a.dataset.localResolved;
      if (local) {
        e.preventDefault();
        const info = JSON.parse(local);
        if (info.md) {
          window.mdReader.openLocalFile(info.path);
        } else {
          window.mdReader.openExternal(info.url);
        }
      }
    });
  }

  /**
   * Render markdown string to HTML
   * @param {string} markdownString
   * @returns {string} rendered HTML
   */
  function render(markdownString) {
    const { text, map } = normalizeMarkdown(markdownString);
    return md.render(text, { offsetMap: map });
  }

  /**
   * Update the preview container with rendered markdown
   * @param {string} markdownString
   * @param {HTMLElement} container
   * @param {string} [docPath] - document path used to resolve relative resources
   */
  function updatePreview(markdownString, container, docPath) {
    if (!container) return;
    container.innerHTML = render(markdownString);
    sanitizeDOM(container);
    resolveLocalResources(container, docPath);
    bindContainerClick(container);
  }

  // Export to window
  window.MDReaderPreview = { render, updatePreview };
})();
