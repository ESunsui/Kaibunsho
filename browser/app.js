(() => {
  const config = {
    githubRepositoryUrl: "",
    githubBranch: "main",
    indexPath: "文章索引.md",
    localIndexPath: "../文章索引.md",
    localArticles: [],
    requestTimeoutMs: 12000,
    ...(window.KAIBUNSHO_READER_CONFIG || {})
  };

  const storageKeys = {
    theme: "kaibunsho-reader-theme",
    currentArticle: "kaibunsho-reader-current-article"
  };

  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const state = {
    articles: [],
    currentArticleId: "",
    loadToken: null,
    sourceName: ""
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    Object.assign(els, {
      articleContent: document.querySelector("#articleContent"),
      articleList: document.querySelector("#articleList"),
      articleMeta: document.querySelector("#articleMeta"),
      articleSource: document.querySelector("#articleSource"),
      articleTitle: document.querySelector("#articleTitle"),
      folderButton: document.querySelector("#folderButton"),
      refreshButton: document.querySelector("#refreshButton"),
      searchInput: document.querySelector("#searchInput"),
      sourceStatus: document.querySelector("#sourceStatus"),
      themeIcon: document.querySelector("#themeIcon"),
      themeToggle: document.querySelector("#themeToggle")
    });

    applyTheme(getInitialTheme());
    els.themeToggle.addEventListener("click", toggleTheme);
    els.refreshButton.addEventListener("click", loadInitialSource);
    els.folderButton.addEventListener("click", loadFolderSource);
    els.searchInput.addEventListener("input", renderArticleList);
    els.articleList.addEventListener("click", handleArticleListClick);
    window.addEventListener("keydown", handleReaderShortcuts);

    loadInitialSource();
  }

  async function loadInitialSource() {
    const errors = [];
    setStatus("正在读取索引...");
    showMessage("loading", "正在加载文章索引。");

    if (hasGithubSource()) {
      try {
        await setArticles(await loadGithubIndex(), "GitHub 远程索引");
        return;
      } catch (error) {
        errors.push(`GitHub：${error.message}`);
      }
    }

    try {
      await setArticles(await loadLocalIndex(), "仓库本地索引");
      return;
    } catch (error) {
      errors.push(`本地索引：${error.message}`);
    }

    try {
      const articles = createConfiguredLocalArticles();
      if (articles.length > 0) {
        await setArticles(articles, "配置中的本地正文");
        return;
      }
    } catch (error) {
      errors.push(`本地正文配置：${error.message}`);
    }

    state.articles = [];
    renderArticleList();
    setStatus("尚未找到可读取的文章源");
    showMessage(
      "empty",
      [
        "没有读取到文章。请在仓库根目录添加 文章索引.md，或点击“选择正文文件夹”直接读取本地 Markdown。",
        "需要远程拉取时，在 browser/config.js 中填写 GitHub 仓库链接。"
      ],
      errors
    );
  }

  async function loadGithubIndex() {
    const rawBaseUrl = getGithubRawBaseUrl();
    const indexUrl = resolveContentUrl(config.indexPath, rawBaseUrl);
    const indexMarkdown = await fetchText(indexUrl);
    const articles = parseIndexMarkdown(indexMarkdown, {
      baseUrl: rawBaseUrl,
      source: "GitHub",
      indexUrl
    });

    if (articles.length === 0) {
      throw new Error("文章索引中没有发现 Markdown 链接");
    }

    return articles;
  }

  async function loadLocalIndex() {
    const localIndexUrl = new URL(config.localIndexPath || `../${config.indexPath}`, window.location.href).href;
    const baseUrl = new URL("./", localIndexUrl).href;
    const indexMarkdown = await fetchText(localIndexUrl);
    const articles = parseIndexMarkdown(indexMarkdown, {
      baseUrl,
      source: "本地仓库",
      indexUrl: localIndexUrl
    });

    if (articles.length === 0) {
      throw new Error("文章索引中没有发现 Markdown 链接");
    }

    return articles;
  }

  async function loadFolderSource() {
    if (!("showDirectoryPicker" in window)) {
      showMessage("error", "当前浏览器不支持直接选择本地文件夹。请改用本地文章索引或通过 HTTP 服务打开此页面。");
      return;
    }

    try {
      setStatus("请选择仓库内的 正文 文件夹");
      const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
      const articles = await readMarkdownDirectory(directoryHandle);

      if (articles.length === 0) {
        showMessage("empty", "所选文件夹中没有发现 .md 文件。");
        setStatus("本地文件夹为空");
        return;
      }

      await setArticles(articles, `本地文件夹：${directoryHandle.name}`);
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus(state.sourceName || "已取消选择文件夹");
        return;
      }

      showMessage("error", `读取本地文件夹失败：${error.message}`);
      setStatus("读取本地文件夹失败");
    }
  }

  async function readMarkdownDirectory(directoryHandle) {
    const articles = [];

    async function walk(handle, prefix = "") {
      for await (const [name, childHandle] of handle.entries()) {
        const relativePath = prefix ? `${prefix}/${name}` : name;

        if (childHandle.kind === "directory") {
          await walk(childHandle, relativePath);
          continue;
        }

        if (childHandle.kind === "file" && /\.md$/i.test(name)) {
          articles.push({
            id: `folder:${relativePath}`,
            title: titleFromPath(name),
            path: relativePath,
            source: "本地正文文件夹",
            fetchContent: async () => {
              const file = await childHandle.getFile();
              return file.text();
            }
          });
        }
      }
    }

    await walk(directoryHandle);
    return articles.sort((a, b) => collator.compare(a.path, b.path));
  }

  function createConfiguredLocalArticles() {
    return (config.localArticles || [])
      .filter((article) => article && article.path)
      .map((article) => {
        const url = new URL(article.path, window.location.href).href;
        return {
          id: `configured:${url}`,
          title: article.title || titleFromPath(article.path),
          path: article.path,
          source: "本地正文配置",
          url,
          fetchContent: () => fetchText(url)
        };
      });
  }

  async function setArticles(articles, sourceName) {
    state.articles = dedupeArticles(articles).sort((a, b) => collator.compare(a.title, b.title));
    state.sourceName = sourceName;
    state.currentArticleId = "";
    setStatus(`${sourceName} · ${state.articles.length} 篇文章`);
    renderArticleList();

    const previousArticleId = localStorage.getItem(storageKeys.currentArticle);
    const article = state.articles.find((item) => item.id === previousArticleId) || state.articles[0];

    if (article) {
      await selectArticle(article.id, { restoreScroll: false });
    }
  }

  function dedupeArticles(articles) {
    const seen = new Set();
    return articles.filter((article) => {
      const key = article.url || article.path || article.id;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  async function selectArticle(articleId, options = {}) {
    const article = state.articles.find((item) => item.id === articleId);
    if (!article) {
      return;
    }

    const token = Symbol(articleId);
    state.loadToken = token;
    state.currentArticleId = articleId;
    localStorage.setItem(storageKeys.currentArticle, articleId);
    renderArticleList();
    showMessage("loading", "正在载入正文。");

    try {
      const markdown = await article.fetchContent();
      if (state.loadToken !== token) {
        return;
      }

      const readableMarkdown = stripFrontMatter(markdown);
      const title = extractMarkdownTitle(readableMarkdown) || article.title;
      els.articleTitle.textContent = title;
      els.articleSource.textContent = article.source || state.sourceName || "Markdown";
      els.articleMeta.textContent = article.path || article.url || "";
      els.articleContent.innerHTML = renderMarkdown(readableMarkdown, article.url);

      if (!options.restoreScroll) {
        document.querySelector(".reader-panel").scrollIntoView({ block: "start" });
      }
    } catch (error) {
      if (state.loadToken !== token) {
        return;
      }

      showMessage("error", `正文加载失败：${error.message}`);
    }
  }

  function renderArticleList() {
    const query = els.searchInput.value.trim().toLocaleLowerCase("zh-CN");
    const visibleArticles = query
      ? state.articles.filter((article) => {
          const text = `${article.title} ${article.path || ""} ${article.url || ""}`.toLocaleLowerCase("zh-CN");
          return text.includes(query);
        })
      : state.articles;

    if (visibleArticles.length === 0) {
      els.articleList.innerHTML = `<div class="empty-state">${state.articles.length ? "没有匹配的文章。" : "暂无文章。"}</div>`;
      return;
    }

    els.articleList.innerHTML = visibleArticles
      .map(
        (article) => `
          <button class="article-item ${article.id === state.currentArticleId ? "is-active" : ""}" type="button" data-id="${escapeAttr(article.id)}">
            <strong>${escapeHtml(article.title)}</strong>
            <span>${escapeHtml(article.path || article.url || article.source || "")}</span>
          </button>
        `
      )
      .join("");
  }

  function handleArticleListClick(event) {
    const button = event.target.closest("[data-id]");
    if (!button) {
      return;
    }

    selectArticle(button.dataset.id);
  }

  function handleReaderShortcuts(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      return;
    }

    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || state.articles.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      state.articles.findIndex((article) => article.id === state.currentArticleId)
    );
    const nextIndex = event.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
    const nextArticle = state.articles[nextIndex];

    if (nextArticle) {
      selectArticle(nextArticle.id);
    }
  }

  function parseIndexMarkdown(markdown, context) {
    const articles = [];
    const seen = new Set();
    let inCodeBlock = false;

    markdown.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        inCodeBlock = !inCodeBlock;
        return;
      }

      if (inCodeBlock) {
        return;
      }

      for (const match of line.matchAll(/\[([^\]]+)]\(([^)]+)\)/g)) {
        if (line[match.index - 1] === "!") {
          continue;
        }

        addArticle(match[2], match[1]);
      }

      for (const match of line.matchAll(/(?:^|[\s>*-])((?:https?:\/\/|\.{0,2}\/|正文\/|文章\/)[^\s)]+\.md(?:#[^\s)]*)?)/gi)) {
        addArticle(match[1], "");
      }
    });

    function addArticle(rawHref, rawTitle) {
      const href = extractMarkdownHref(rawHref);
      if (!isMarkdownHref(href)) {
        return;
      }

      const url = resolveContentUrl(href, context.baseUrl);
      if (seen.has(url)) {
        return;
      }

      seen.add(url);
      articles.push({
        id: `${context.source}:${url}`,
        title: cleanTitle(rawTitle) || titleFromPath(href),
        path: decodePath(href),
        source: context.source,
        url,
        fetchContent: () => fetchText(url)
      });
    }

    return articles;
  }

  function renderMarkdown(markdown, baseUrl = window.location.href) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const html = [];
    const paragraph = [];
    let inCodeBlock = false;
    let codeLanguage = "";
    let codeLines = [];
    let listType = "";

    const closeParagraph = () => {
      if (paragraph.length > 0) {
        html.push(`<p>${paragraph.join("<br />")}</p>`);
        paragraph.length = 0;
      }
    };

    const closeList = () => {
      if (listType) {
        html.push(`</${listType}>`);
        listType = "";
      }
    };

    const openList = (type) => {
      closeParagraph();
      if (listType !== type) {
        closeList();
        html.push(`<${type}>`);
        listType = type;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\t/g, "    ");
      const trimmed = line.trim();
      const fence = /^```(\S*)?/.exec(trimmed);

      if (fence) {
        if (inCodeBlock) {
          html.push(`<pre><code${codeLanguage ? ` class="language-${escapeAttr(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          inCodeBlock = false;
          codeLanguage = "";
          codeLines = [];
        } else {
          closeParagraph();
          closeList();
          inCodeBlock = true;
          codeLanguage = fence[1] || "";
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(rawLine);
        continue;
      }

      if (!trimmed) {
        closeParagraph();
        closeList();
        continue;
      }

      const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${formatInline(heading[2], baseUrl)}</h${level}>`);
        continue;
      }

      if (/^[-*_]{3,}$/.test(trimmed)) {
        closeParagraph();
        closeList();
        html.push("<hr />");
        continue;
      }

      const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
      if (unordered) {
        openList("ul");
        html.push(`<li>${formatInline(unordered[1], baseUrl)}</li>`);
        continue;
      }

      const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (ordered) {
        openList("ol");
        html.push(`<li>${formatInline(ordered[1], baseUrl)}</li>`);
        continue;
      }

      const quote = /^>\s?(.+)$/.exec(trimmed);
      if (quote) {
        closeParagraph();
        closeList();
        html.push(`<blockquote><p>${formatInline(quote[1], baseUrl)}</p></blockquote>`);
        continue;
      }

      closeList();
      paragraph.push(formatInline(trimmed, baseUrl));
    }

    if (inCodeBlock) {
      html.push(`<pre><code${codeLanguage ? ` class="language-${escapeAttr(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    }

    closeParagraph();
    closeList();

    return html.join("\n") || `<div class="empty-state">这篇文章没有正文内容。</div>`;
  }

  function formatInline(text, baseUrl) {
    const codeSpans = [];
    let output = text.replace(/`([^`]+)`/g, (_, code) => {
      codeSpans.push(`<code>${escapeHtml(code)}</code>`);
      return `\u0000CODE${codeSpans.length - 1}\u0000`;
    });

    output = escapeHtml(output);
    output = output.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_, alt, rawUrl) => {
      const url = resolveDisplayUrl(rawUrl, baseUrl);
      return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
    });
    output = output.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label, rawUrl) => {
      const url = resolveDisplayUrl(rawUrl, baseUrl);
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
    output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    output = output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeSpans[Number(index)] || "");

    return output;
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        cache: "no-cache",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }

      return response.text();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("请求超时");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function getGithubRawBaseUrl() {
    const configuredUrl = (config.githubRepositoryUrl || "").trim();

    if (!configuredUrl) {
      return "";
    }

    if (/^https:\/\/raw\.githubusercontent\.com\//i.test(configuredUrl)) {
      return ensureTrailingSlash(configuredUrl);
    }

    const repoMatch = configuredUrl.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
    if (!repoMatch) {
      throw new Error("GitHub 仓库链接格式不正确");
    }

    const owner = repoMatch[1];
    const repo = repoMatch[2];
    const branch = config.githubBranch || "main";
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
  }

  function resolveContentUrl(href, baseUrl) {
    const normalizedHref = normalizeGithubUrl(extractMarkdownHref(href).replace(/^\/+/, ""));
    if (/^https?:\/\//i.test(normalizedHref)) {
      return normalizedHref;
    }

    return new URL(encodeURI(normalizedHref), baseUrl || window.location.href).href;
  }

  function resolveDisplayUrl(rawUrl, baseUrl) {
    const href = decodeHtmlEntities(extractMarkdownHref(rawUrl));

    if (!href || /^javascript:/i.test(href)) {
      return "#";
    }

    if (/^(mailto:|#)/i.test(href)) {
      return href;
    }

    return resolveContentUrl(href, baseUrl || window.location.href);
  }

  function normalizeGithubUrl(href) {
    return href.replace(
      /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([^/\s]+)\/(.+)$/i,
      "https://raw.githubusercontent.com/$1/$2/$3/$4"
    );
  }

  function hasGithubSource() {
    return Boolean((config.githubRepositoryUrl || "").trim());
  }

  function extractMarkdownHref(rawHref) {
    const withoutEntities = decodeHtmlEntities(String(rawHref || "").trim());
    const withoutAngleBrackets = withoutEntities.replace(/^<(.+)>$/, "$1").trim();
    const match = withoutAngleBrackets.match(/^(.+?\.md(?:#[^\s"']*)?)(?:\s+["'][^"']+["'])?$/i);
    return (match ? match[1] : withoutAngleBrackets).replace(/\\/g, "/").trim();
  }

  function isMarkdownHref(href) {
    return /\.md(?:#.*)?$/i.test(href);
  }

  function extractMarkdownTitle(markdown) {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? cleanTitle(match[1]) : "";
  }

  function stripFrontMatter(markdown) {
    return String(markdown || "").replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  }

  function titleFromPath(path) {
    const filename = decodePath(String(path || "").split("#")[0]).split("/").pop() || "未命名文章";
    return filename.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  }

  function cleanTitle(title) {
    return decodeHtmlEntities(String(title || ""))
      .replace(/^[#>*\-\s]+/, "")
      .replace(/[`*_~]/g, "")
      .trim();
  }

  function decodePath(path) {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }

  function decodeHtmlEntities(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  function ensureTrailingSlash(value) {
    return value.endsWith("/") ? value : `${value}/`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function showMessage(type, message, details = []) {
    const className = `${type}-state`;
    const lines = Array.isArray(message) ? message : [message];
    const detailItems = details.filter(Boolean).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("");
    els.articleContent.innerHTML = `
      <div class="${className}">
        ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        ${detailItems ? `<ul>${detailItems}</ul>` : ""}
      </div>
    `;
  }

  function setStatus(message) {
    els.sourceStatus.textContent = message;
  }

  function getInitialTheme() {
    const storedTheme = localStorage.getItem(storageKeys.theme);
    if (storedTheme) {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    const normalizedTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = normalizedTheme;
    localStorage.setItem(storageKeys.theme, normalizedTheme);
    els.themeIcon.textContent = normalizedTheme === "dark" ? "☾" : "☼";
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  }
})();
