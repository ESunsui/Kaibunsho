window.KAIBUNSHO_READER_CONFIG = {
  // 留空时优先读取仓库根目录的 ./文章索引.md。
  // 支持填写 https://github.com/<owner>/<repo> 或 https://raw.githubusercontent.com/<owner>/<repo>/<branch>/。
  githubRepositoryUrl: "",
  githubBranch: "main",

  // 远程与本地共用的索引文件名。索引内的 Markdown 链接会被解析为正文入口。
  indexPath: "文章索引.md",
  localIndexPath: "../文章索引.md",

  // 可选：浏览器无法自动遍历静态目录时，可在这里手动声明本地正文文件。
  // 示例：{ title: "第一章", path: "../正文/第一章.md" }
  localArticles: [],

  requestTimeoutMs: 12000
};
