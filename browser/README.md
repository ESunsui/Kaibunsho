# Kaibunsho Reader

这是一个纯静态 Markdown 阅读器，可直接放在浏览器中运行或部署为静态页面。

## 使用方式

Windows 下可直接双击仓库根目录的 `启动阅读器.vbs`。它会隐藏启动本地服务，并自动打开：

```text
http://127.0.0.1:8080/browser/
```

不再阅读时，可双击仓库根目录的 `关闭阅读器服务.vbs`。

这个双击启动方式不依赖 Python 或 Node.js，只需要 Windows 自带的 PowerShell。

如果需要手动启动，也可以运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\browser\reader-launcher.ps1
```

然后打开 `http://127.0.0.1:8080/browser/`。

## 本地正文

阅读器启动时会优先读取仓库根目录的 `文章索引.md`。索引中出现的 Markdown 链接会被识别为正文，例如：

```markdown
# 文章索引

- [第一章](正文/第一章.md)
- [第二章](正文/第二章.md)
```

也可以点击页面左侧的“选择正文文件夹”，直接选择仓库内的 `正文` 文件夹读取其中的 `.md` 文件。

## GitHub 远程正文

在 `config.js` 中填写仓库链接后，阅读器会先下载远程仓库根目录的 `文章索引.md`，再按索引中的链接下载正文。

```js
window.KAIBUNSHO_READER_CONFIG = {
  githubRepositoryUrl: "https://github.com/<owner>/<repo>",
  githubBranch: "main",
  indexPath: "文章索引.md"
};
```

当前 `githubRepositoryUrl` 按需求保持为空。
