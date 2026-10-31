/* ==========================================
   MD reader — Preview (DOM side of rendering)
   Bundled via esbuild. Parsing rules live in ./markdown.js.
   ========================================== */

(function () {
  const { createMarkdown, renderMarkdown } = require('./markdown');

  let md = createMarkdown();
  let labels = {};

  /**
   * @param {{breaks?: boolean, typographer?: boolean, labels?: object}} options
   */
  function configure(options = {}) {
    md = createMarkdown(options);
    if (options.labels) labels = options.labels;
  }

  // ---- Sanitize: strip dangerous elements/attributes (defense in depth
  //      behind CSP — script-src 'self' already blocks inline scripts) ----
  const REMOVE_TAGS = new Set([
    'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'style', 'form', 'frame', 'frameset',
  ]);
  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);

  function sanitizeDOM(root) {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const tag = el.tagName.toLowerCase();
      if (REMOVE_TAGS.has(tag) || (tag === 'input' && (el.type !== 'checkbox' || !el.disabled))) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') {
          el.removeAttribute(attr.name);
        } else if (URL_ATTRS.has(name)) {
          const val = attr.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
          if (/^(javascript|vbscript):/.test(val) || /^data:text\/html/.test(val)) {
            el.removeAttribute(attr.name);
          }
        }
      }
    }
  }

  // ---- Resolve relative resources against the document directory ----
  function resolveLocalResources(root, docPath) {
    if (!docPath) return;

    root.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|file:|data:|blob:)/i.test(src)) return;
      const resolved = window.mdReader.resolveFileUrl(docPath, src);
      if (resolved) img.setAttribute('src', resolved.url);
    });

    root.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || /^(https?:|mailto:|#)/i.test(href)) return;
      const resolved = window.mdReader.resolveFileUrl(docPath, href);
      if (resolved) {
        link.dataset.localPath = resolved.path;
        link.dataset.localHash = resolved.hash;
      }
    });
  }

  function addCopyButtons(root) {
    root.querySelectorAll('pre > code').forEach((code) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = labels.copy || 'Copy';
      code.parentNode.insertBefore(button, code);
    });
  }

  const boundContainers = new WeakSet();

  function emit(container, name, detail) {
    container.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function bindContainerClick(container) {
    if (boundContainers.has(container)) return;
    boundContainers.add(container);

    container.addEventListener('click', (e) => {
      const copy = e.target.closest('.code-copy');
      if (copy) {
        const code = copy.parentNode.querySelector('code');
        window.mdReader.copyText(code ? code.textContent : '');
        copy.textContent = labels.copied || 'Copied';
        setTimeout(() => {
          copy.textContent = labels.copy || 'Copy';
        }, 1200);
        return;
      }

      const a = e.target.closest('a[href]');
      if (!a) return;
      // Never let the preview navigate the app window itself.
      e.preventDefault();
      const href = a.getAttribute('href');

      if (href.startsWith('#')) {
        emit(container, 'md-anchor', { id: href.slice(1) });
      } else if (/^(https?:|mailto:)/i.test(href)) {
        window.mdReader.openExternal(href);
      } else if (a.dataset.localPath) {
        const filePath = a.dataset.localPath;
        if (/\.(md|markdown|mdown)$/i.test(filePath)) {
          emit(container, 'md-open', { path: filePath, hash: a.dataset.localHash || '' });
        } else {
          window.mdReader.openLocalPath(filePath);
        }
      }
    });
  }

  /**
   * Render markdown into the container.
   * @param {string} markdownString
   * @param {HTMLElement} container
   * @param {string} [docPath] - document path used to resolve relative resources
   */
  function updatePreview(markdownString, container, docPath) {
    if (!container) return;
    container.innerHTML = renderMarkdown(md, markdownString, labels);
    sanitizeDOM(container);
    resolveLocalResources(container, docPath);
    addCopyButtons(container);
    bindContainerClick(container);
  }

  window.MDReaderPreview = { configure, updatePreview };
})();
