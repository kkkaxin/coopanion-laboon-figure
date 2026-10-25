# 小拉布 · Coopanion 形象包（`laboon`）

Coopanion 桌面宠物形象包，`manifest: 2` / `api: 2`。一张正面待机图 + 一张侧身游动图，都是 1024×1024 透明底。

## 现状

- 包 id：`laboon`；目录名：`laboon`；名称：小拉布 / Laboon；作者：kkkaxin；版本 0.1.0。
- 入口 `figure.js` → `export createLaboonBody`；单套外观（轴 `outfit`，唯一选项 `default`，accent `#2f6ea8`）。
- 词汇 30 个：14 个表情 + 16 个动作，结构与 dafayou 包一致。
- **头高对齐**：两张图按「眼睛到头顶 + 眼睛到下颌」的头部高度对齐（正面 888 px / 侧面 650 px，头高比 1.3662），画布内头部高度均为 476.5 px，切换时脑袋不会一大一小。
- **视图切换**：`walk` / `run` 时切到侧身图（`laboon-side.png`），并叠加 `0..-6 px`、周期 0.6 s 的上下浮动；停止移动后 **0.2 s** 才切回正面；两次切换之间 **0.12 s 交叉淡入**。
- **眨眼/睡觉**：非移动时切 `laboon-closed.png`（正面闭眼）；移动时没有侧身闭眼图，眼睛保持睁开，不会跳。
- 无自带音效（`sounds: {}`）。
- 已在 Coopanion **0.2.8** / `cortico-world-desktop-pet` **0.2.0** 的 API 2 契约下校对。

## 已知限制（v0.1.0）

- 只有正面/侧面各一张图（闭眼只有正面版）：**移动时不会闭眼**（无侧身闭眼图，保持睁眼不跳）；闭眼图与正面图除眼部外逐像素一致。
- 正面与侧面是两张 AI 生成图，轮廓不完全一致，切换靠 0.12 s 交叉淡入过渡。

## 安装 / 打包 / 校验

```
node tools/pack.mjs        # -> 工作区根 laboon-v0.1.0.zip（根下一层 laboon/）
node tools/validate-pack.mjs "<包目录>"
```

安装：Coopanion「装扮 → 导入」选 zip；或把 `laboon` 目录覆盖到
`C:\Users\kkkaxin\AppData\Local\Programs\Coopanion\data\home\companion\data\figures\laboon` 后重启。

## 文件

| 文件 | 作用 |
|---|---|
| `figure.json` | manifest：id、名字、外观轴、词汇、about、credits |
| `figure.js` | 绘制：正面/侧面选图（延迟 + 淡入）、游动浮动、坐姿下沉 |
| `laboon.png` | 正面（待机，睁眼） |
| `laboon-closed.png` | 正面（闭眼；blink/sleep） |
| `laboon-side.png` | 侧面（走路/跑步/游动） |
| `tools/prepare-art.py` | 两张源图 → 抠图、按头高配准、1024 成品 + 常量测量 |
| `tools/make-closed.py` | 以正面图为底，只改眼睛生成闭眼帧（含像素级校验） |
| `tools/validate-pack.mjs` | 按宿主 `readManifest` 规则校验 |
| `tools/pack.mjs` | 纯 Node 打可导入 zip |
| `ART-SOURCE.md` | 源图、配准数值、处理结果 |

## 署名与权利

见 [RIGHTS.md](RIGHTS.md)。形象「小拉布 / Laboon」由 kkkaxin 依据用户提供的参考图用 AI 生图工具制作；`figure.js` / manifest 结构参考 dafayou 包。

## 官方格式说明

[Coopanion 形象包文档](https://github.com/Pal-AI-Lab/Coopanion/tree/main/packages/cortico-world-desktop-pet#形象包)。
