# personal-site

蒋志超的中英双语个人网站。Astro 静态站，部署到 GitHub Pages https://doctorzero666.github.io

中文在 `/`，英文在 `/en/`。四个页面：主页、简历（`/resume/`）、作品集（`/portfolio/`）、博客（`/blog/`）。

## 本地运行

需要 Node 22.12 或更高，npm 9.6.5 或更高。

```bash
npm install
npm run dev       # 开发服务器 http://localhost:4321
npm run build     # 产物在 dist/
npm run preview   # 本地预览 dist/
npx astro check   # 类型检查
```

### 版面检查（开发用）

`scripts/check-layout.mjs` 用本机 Chrome（`puppeteer-core`，不下载 Chromium）检查全部 8 个页面在 390×844 和 1280×800 两种视口下是否横向溢出，并检查主页 hero 名字是否可见。

```bash
npm run build
npx astro preview --port 4321      # 另开一个终端
node scripts/check-layout.mjs      # 有溢出或名字不可见时以非 0 退出
```

- Chrome 路径默认是 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `CHROME_PATH` 覆盖；站点地址可用 `BASE_URL` 覆盖。
- 每行打印 `scrollWidth` 与 `innerWidth`。由于 `body` 设置了 `overflow-x: clip`，脚本还会列出越过视口右边缘的元素。
- 注意：无头 Chrome 的窗口宽度最小为 500px，用 `--window-size=390,…` 截出的图其实是 500px 宽的版面裁成 390px，右侧会看起来被切掉。手机宽度请以本脚本为准，它通过 DevTools 设置真正的 390px 视口。

## 内容从哪里来

页面上的文字全部来自数据文件，组件里不写正文。字段模式见 `content-schema.md` v1（存于 `~/claude-tmp/personal-site/content-schema.md`），键名不得增删改。

| 文件 | 内容 |
| --- | --- |
| `src/data/profile.yaml` | 姓名、hero 大字、headline、tagline、所在城市与时区、主页 intro、hero 三个小标签、邮箱、外链、页脚铭牌、版权名 |
| `src/data/projects.yaml` | 项目列表。`featured: true` 的按 `order` 进主页表格和作品集页（最多 5 个）；`featured: false` 的进主页「更多作品」卡片格 |
| `src/data/resume.yaml` | 简历：summary、education、experience、awards、skills、pdf |
| `src/i18n/zh.json`、`src/i18n/en.json` | 界面文字（导航、按钮、分节标题、空状态等），两份键名保持一致 |

规则：

- 所有面向访客的文本都是 `{zh: "...", en: "..."}`。中文为准；英文留空时页面回退显示中文。
- 主页 intro 中用方括号包住的短语（如 `[智能体系统]`）会加粗显示。
- 链接的 `url` 为空时不渲染该链接；`disclosure` 为空时作品集页不显示「口径说明」行。

当前 `src/data/` 下是占位数据，待真实内容整体覆盖。

## 写博客文章

在 `src/content/blog/` 新建 Markdown 文件，一种语言一个文件：

```markdown
---
title: "文章标题"
date: 2026-10-15
lang: zh            # zh 或 en
description: "一句话摘要，用于列表与 SEO"
---

正文……
```

文件名即 URL：`src/content/blog/agent-seams.md`（`lang: zh`）发布在 `/blog/agent-seams/`；英文版建议放 `src/content/blog/en/agent-seams.md`（`lang: en`），发布在 `/en/blog/en/agent-seams/`，或直接用不同文件名。博客列表只显示当前语言的文章；没有文章时显示空状态文案。

## 部署

`.github/workflows/deploy.yml` 在 push 到 `main` 时用 `withastro/action@v3` 构建并用 `actions/deploy-pages@v4` 发布。首次启用步骤：

1. 在 GitHub 建仓库 `doctorzero666.github.io`（用户站点仓库，站点在根路径，无需 `base`）。若改用其他仓库名，需在 `astro.config.mjs` 里加 `base: '/仓库名'`，并把站内链接改为带 base 的写法。
2. `git remote add origin git@github.com:doctorzero666/doctorzero666.github.io.git && git push -u origin main`。
3. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
4. 之后每次 push 到 main 自动发布。

`astro.config.mjs` 里的 `site` 用于生成 canonical 与 hreflang 链接。

## 统计（Analytics）

GA4 衡量 ID 只从环境变量 `PUBLIC_GA_MEASUREMENT_ID` 读取，源码里不写死。

- 本地：复制 `.env.example` 为 `.env` 并填入 ID（`.env` 已被 git 忽略）。
- GitHub：Settings → Secrets and variables → Actions → Variables，新建仓库变量 `PUBLIC_GA_MEASUREMENT_ID`。
- `npm run dev` 不输出统计代码；生产构建在 localhost / 127.0.0.1 / ::1 上运行时也不加载 gtag.js，所以 `npm run preview` 不会产生数据。

## 设计

- 色板：亮色背景 `#F3EEE4`、墨色 `#2B2926`、hero 强调色 Klein 蓝 `#002FA7`；暗色背景 `#2B2926`、文字 `#F3EEE4`、强调色 `#C3FFFC`。token 在 `src/styles/global.css` 顶部。
- 主题手动切换（`<html data-theme>`），选择存 `localStorage`；首次访问按系统偏好取初值。切换脚本内联在 `<head>`，首绘前执行，无闪烁。
- 1200px 容器、24px 侧边距、12 列栅格、8px 基线；文章单栏 792px。零圆角、零阴影、1px 细线。
- 动效只有滚动淡入上浮（`prefers-reduced-motion` 时关闭）、链接悬停下划线和 hero 的像素人物（见下节）。

## Hero 像素人物

hero 右侧是一个由小圆角方块拼成的人物：入场时方块聚拢，平时随微风轻摆、偶尔闪烁，鼠标划过会把方块冲散，随后弹回原位；触屏按下时冲散一次，不影响页面滚动。`prefers-reduced-motion` 时只画静止的人物。无 JS 时只显示 hero 底色。

- 参数：`src/data/hero-pixel.json`，由调参页（`~/claude-tmp/personal-site/pixel-tuner/`）导出，原样存放。改效果就改这个文件，代码里不写数值。渐变色在深浅两种主题下相同；`color.background` 与 `text.*` 只用于调参页预览，站点不读（canvas 透明，文字沿用站点 token）。桌面 / 窄屏的摆放以 900px 为界。
- 运行时：`src/lib/hero-pixel.ts`，在 `Hero.astro` 中挂载。尺寸变化时才重新采样与着色，每帧只画。hero 不在视口内或标签页隐藏时停帧。
- 避让名字（只在桌面摆放下）：人物最左侧的方块与名字两行中较宽一行的字形右缘至少隔 2 个网格步距（16px，即 `hero-pixel.ts` 里的 `TEXT_CLEARANCE_CELLS`）。不够时人物按比例缩小，`centerXPct` 和底边位置不变；够的视口与参数原样一致。尺寸变化和网页字体加载完成后重算，不重播入场。这个间距是代码常量，不在 `hero-pixel.json` 里。
- 抠图是离线做的。原图不在仓库里，本地副本在 `~/claude-tmp/personal-site/pixel-tuner/source.jpg`；生成的透明底图 `src/assets/hero/portrait.webp` 提交在仓库中，构建时打包进 `dist/_astro/`。改了原图或 `mask.*` 后重新生成并提交：

  ```bash
  node scripts/build-hero-portrait.mjs ~/claude-tmp/personal-site/pixel-tuner/source.jpg
  # 不给路径会报错退出；也可用 HERO_SOURCE=<路径>。用本机 Chrome 解码和编码，同样输入得到同一个文件，会打印 sha256
  ```

## 字体与许可

全部自托管，构建时由 Vite 打包进 `dist/_astro/`，运行时不请求任何第三方字体服务。

| 字体 | 用途 | npm 包 | 许可 |
| --- | --- | --- | --- |
| Instrument Serif | 大标题、页脚邮箱、编号 | `@fontsource/instrument-serif`（仅 latin 400） | SIL OFL 1.1 |
| Geist（可变字重） | 正文 | `@fontsource-variable/geist` | SIL OFL 1.1 |
| Rubik（可变字重） | hero 大名字 | `@fontsource-variable/rubik` | SIL OFL 1.1 |
| Koulen | 页脚铭牌 | `@fontsource/koulen`（仅 latin 400） | SIL OFL 1.1 |

中文不打包字体，回退到系统字体栈：`-apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`（衬线标题回退 `Songti SC` / `Noto Serif CJK SC`）。

## 目录

```
src/
  data/          YAML 数据文件；hero-pixel.json 是像素人物参数
  i18n/          界面文字与语言工具函数
  lib/data.ts    读取 YAML、类型定义、取当前语言文本
  lib/hero-pixel.ts  hero 像素人物（采样、着色、粒子动画）
  assets/hero/   抠好的 hero 人物透明底图（原图不入库）
  styles/        全局 token 与基础样式
  layouts/       Base.astro（head、主题脚本、SEO、reveal）
  components/    Header、Footer、Hero、ProjectTable、MoreWorks、ProjectLinks、Icon
  views/         四个页面的实际内容（中英文路由共用）
  pages/         路由；/en/ 下是英文版
  content/blog/  博客 Markdown
```
