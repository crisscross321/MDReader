/* ==========================================
   MD reader — Renderer strings (zh / en)
   ========================================== */

(function () {
  const lang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const mod = window.mdReader && window.mdReader.platform === 'darwin' ? '⌘' : 'Ctrl+';

  const STRINGS = {
    en: {
      welcomeSubtitle: 'Open a Markdown file to start reading',
      openFile: 'Open File',
      welcomeHint: 'or press {mod}O, or drop a file onto the window',
      recent: 'Recent',
      outline: 'Outline',
      noHeadings: 'No headings',
      find: 'Find in document ({mod}F)',
      findPlaceholder: 'Find in document…',
      noResults: 'No results',
      prevMatch: 'Previous match (Shift+Enter)',
      nextMatch: 'Next match (Enter)',
      closeFind: 'Close (Esc)',
      showSidebar: 'Show document list ({mod}B)',
      hideSidebar: 'Hide document list ({mod}B)',
      showOutline: 'Show outline ({mod}Shift+O)',
      hideOutline: 'Hide outline ({mod}Shift+O)',
      edit: 'Edit',
      read: 'Read',
      toggleMode: 'Toggle edit mode ({mod}E)',
      toggleTheme: 'Toggle light/dark ({mod}Shift+T)',
      untitled: 'Untitled',
      close: 'Close',
      saved: 'Saved',
      reloaded: '"{name}" reloaded from disk',
      dropHere: 'Drop Markdown files here',
      copy: 'Copy',
      copied: 'Copied',
      frontMatter: 'Front matter',
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
      docCount: '{n} documents open',
    },
    zh: {
      welcomeSubtitle: '打开一个 Markdown 文件开始阅读',
      openFile: '打开文件',
      welcomeHint: '也可以按 {mod}O，或把文件拖进窗口',
      recent: '最近打开',
      outline: '大纲',
      noHeadings: '没有标题',
      find: '在文档中查找（{mod}F）',
      findPlaceholder: '在文档中查找…',
      noResults: '无结果',
      prevMatch: '上一个（Shift+Enter）',
      nextMatch: '下一个（Enter）',
      closeFind: '关闭（Esc）',
      showSidebar: '显示文档列表（{mod}B）',
      hideSidebar: '隐藏文档列表（{mod}B）',
      showOutline: '显示大纲（{mod}Shift+O）',
      hideOutline: '隐藏大纲（{mod}Shift+O）',
      edit: '编辑',
      read: '阅读',
      toggleMode: '切换编辑模式（{mod}E）',
      toggleTheme: '切换浅色/深色（{mod}Shift+T）',
      untitled: '未命名',
      close: '关闭',
      saved: '已保存',
      reloaded: '已从磁盘重新载入“{name}”',
      dropHere: '把 Markdown 文件拖到这里',
      copy: '复制',
      copied: '已复制',
      frontMatter: '文档属性',
      note: '注意',
      tip: '提示',
      important: '重要',
      warning: '警告',
      caution: '危险',
      docCount: '已打开 {n} 个文档',
    },
  };

  function t(key, vars = {}) {
    const template = STRINGS[lang][key] || STRINGS.en[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (name === 'mod' ? mod : name in vars ? vars[name] : ''));
  }

  /** Fill static markup: data-i18n (text), data-i18n-title (title + aria-label), data-i18n-placeholder. */
  function apply(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  window.MDReaderI18n = { lang, t, apply };
})();
