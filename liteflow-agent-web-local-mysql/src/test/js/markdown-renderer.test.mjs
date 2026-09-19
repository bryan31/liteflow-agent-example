import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync(
  new URL("../../main/resources/static/app.js", import.meta.url),
  "utf8"
);
const rendererSource = appJs.slice(
  appJs.indexOf("function sanitizeMarkdown"),
  appJs.indexOf("function clearEmptyState")
);
const context = {};
vm.createContext(context);
vm.runInContext(`${rendererSource}; this.renderMarkdown = renderMarkdown;`, context);

const html = context.renderMarkdown(`# 一级

#### 四级标题

连续第一行
连续第二行

---

1. 第一项
2. 第二项

- [x] 已完成
- [ ] 未完成

> 引用第一行
> 引用第二行

~~删除线~~ 和 ![图片](https://example.com/a.png)
`);

assert.match(html, /<h1>一级<\/h1>/);
assert.match(html, /<h4>四级标题<\/h4>/);
assert.match(html, /<p>连续第一行\s+连续第二行<\/p>/);
assert.match(html, /<hr>/);
assert.match(html, /<ol><li>第一项<\/li><li>第二项<\/li><\/ol>/);
assert.match(html, /<ul class="task-list">/);
assert.match(html, /<input type="checkbox" checked disabled>/);
assert.match(html, /<input type="checkbox" disabled>/);
assert.match(html, /<blockquote><p>引用第一行\s+引用第二行<\/p><\/blockquote>/);
assert.match(html, /<del>删除线<\/del>/);
assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="图片">/);
