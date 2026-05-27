<div align="center">

# 🖥️ OpenClaw Dashboard

**OpenClaw 可视化监控工作台** — 实时掌控所有 AI Agent 的运行状态、对话历史、技能配置与资源消耗

[![Version](https://img.shields.io/badge/version-1.8.2-blue.svg)](https://gitee.com/yaconit/openclaw-dashboard/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D.svg)](https://vuejs.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-2.x-409EFF.svg)](https://element-plus.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E%3D2026.3.28-orange.svg)](https://openclaw.ai)

[功能介绍](#-功能特性) · [快速开始](#-快速开始) · [配置说明](#-配置说明) · [截图预览](#-截图预览) · [常见问题](#-常见问题)

</div>

---

## 📖 项目简介

**OpenClaw Dashboard** 是专为 [OpenClaw](https://openclaw.ai) 打造的开源可视化管理工作台。

当你运行了多个 AI Agent（产品经理、开发工程师、测试员、巡检员……），你需要一个地方能：

- **一眼看到**每个 Agent 此刻在做什么、在想什么、调用了什么工具
- **直接发消息**给任意 Agent，查看完整对话历史
- **管理技能库**，查看哪个 Agent 装了哪些技能，一键启用/禁用
- **监控资源消耗**，Token 用了多少、花了多少钱、显存还剩多少
- **查看定时任务**，每个 cron 任务的执行计划和历史记录

这就是 OpenClaw Dashboard 要解决的问题。

---

## ✨ 功能特性

### 🤖 Agent 实时监控
- **状态看板**：运行中 / 空闲 / 错误 / 已终止，四列分类展示所有 Agent
- **实时活动条**：Agent 运行时，卡片底部自动出现绿色脉冲条，显示当前步骤（正在思考 / 调用工具 / 工具结果 / 回复），每 2.5 秒刷新
- **悬停气泡**：鼠标悬停活动条可展开最近 8 步完整活动记录，全部中文展示
- **自定义头像**：为每个 Agent 配置专属头像图片，支持 JPG/PNG，失败自动降级到 emoji

### 💬 对话历史查看
- 点击任意 Agent 卡片，侧边抽屉展示完整会话消息
- 支持筛选：显示/隐藏思考信息、工具调用记录
- Markdown 完整渲染（代码高亮、表格、列表）
- 支持图片粘贴后发送给 Agent（≤5MB）
- 可直接在抽屉内向 Agent 发送新消息

### 🔧 技能库管理
- **Agent 技能面板**：每个 Agent 的已安装技能一览，支持一键启用 / 禁用
- **全局技能对比矩阵**：「对比」标签页展示所有 Agent × 所有技能的二维矩阵，绿点（已激活）/ 橙点（已安装未激活）/ 灰点（未安装），一眼看清差异
- **技能详情**：点击技能查看其包含的工具列表和中文说明
- **ClawHub 搜索**：在线搜索并安装社区技能

### ⏰ 定时任务查看
- 每个 Agent 的所有 Cron 任务列表
- 显示执行计划（每天 08:00 / 每2小时 / 自定义表达式）
- 显示上次运行时间和执行状态
- 点击展开查看任务触发消息详情

### 📊 资源与消耗统计
- **上下文用量**：每个 Agent 的当前会话上下文使用进度条（已用 token / 总上限）
- **历史 Token 消耗**：按 Agent 累计消耗，支持按模型拆分（DeepSeek / MiniMax / Claude 等）
- **本次运行费用**：实时估算当前会话费用（支持自定义电费单价）
- **GPU 显存监控**：顶栏实时显示显存使用百分比（适用于本地部署场景）

### 🖥️ 系统管理
- **版本管理**：查看当前 OpenClaw 版本，支持一键切换历史版本
- **网关健康检查**：实时显示 Gateway 状态，异常时一键诊断
- **Agent 会话重置**：一键重置指定 Agent 的当前会话
- **直达 WebUI**：顶栏快捷入口，跳转 OpenClaw 原生 Web 界面

### 🎨 界面设计
- 深色主题，专为长时间监控优化
- 响应式卡片布局，支持多 Agent 并列显示
- 所有状态变化带动画过渡

---

## 🚀 快速开始

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | ≥ 18.0 |
| OpenClaw | ≥ 2026.3.28 |
| 操作系统 | macOS / Windows / Linux |

### 第一步：安装 Node.js

- **Windows**：[下载安装包 (x64)](https://nodejs.org/dist/v24.15.0/node-v24.15.0-x64.msi)
- **macOS**：[下载安装包 (.pkg)](https://nodejs.org/dist/v24.15.0/node-v24.15.0.pkg)
- **Linux**：[下载压缩包](https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz)

下载后双击安装，一路「下一步」即可。

### 第二步：安装 OpenClaw

```bash
npm i -g openclaw
```

安装完成后执行 `openclaw --version` 验证。

### 第三步：下载 Dashboard

**方式 A：直接下载压缩包（推荐新手）**

前往 [Releases 页面](https://gitee.com/yaconit/openclaw-dashboard/releases) 下载最新版本的 `openclaw-dashboard-vX.X.X.zip`，解压到任意目录。

**方式 B：Git 克隆**

```bash
git clone https://gitee.com/yaconit/openclaw-dashboard.git
cd openclaw-dashboard
```

### 第四步：安装依赖

```bash
npm install
```

### 第五步：配置环境变量

复制示例配置文件：

```bash
# macOS / Linux
cp .env.example .env

# Windows
copy .env.example .env
```

用文本编辑器打开 `.env`，至少填写以下两项：

```env
VITE_GATEWAY_URL=http://127.0.0.1:18789   # OpenClaw Gateway 地址
VITE_GATEWAY_TOKEN=your_token_here         # 从 openclaw.json 复制
```

### 第六步：启动

**macOS / Linux：**
```bash
./start.sh
```

**Windows：**
```bat
start.bat
```

或者手动启动：
```bash
npm run start:all
```

浏览器访问 **http://localhost:31001** 即可看到监控台。

---

## ⚙️ 配置说明

所有配置在 `.env` 文件中完成。

```env
# ── 必填 ──────────────────────────────────
VITE_GATEWAY_URL=http://127.0.0.1:18789    # OpenClaw Gateway 地址
VITE_GATEWAY_TOKEN=your_token_here          # 鉴权 Token

# ── Agent 中文名称（可选）──────────────────
# 格式：VITE_AGENT_<id大写>_NAME=中文名
VITE_AGENT_MAIN_NAME=叶溪
VITE_AGENT_PM_NAME=产品经理-怡雯
VITE_AGENT_DEVELOPER_NAME=开发工程师-瓦利
VITE_AGENT_TESTER_NAME=前端测试-奥托
VITE_AGENT_INSPECTOR_NAME=巡检员-伯恩
VITE_AGENT_ARCHIVIST_NAME=档案员-小波

# ── Agent 自定义头像（可选）──────────────────
# 格式：VITE_AGENT_<id大写>_AVATAR=图片路径
# 也可以直接将图片放到 public/avatars/<id>.jpg 目录
VITE_AGENT_MAIN_AVATAR=/avatars/main.jpg

# ── 费用统计（可选）──────────────────────────
VITE_ELECTRICITY_PRICE=0.6                  # 电费单价（元/度），本地部署用
```

### 端口说明

| 服务 | 默认端口 | 说明 |
|------|----------|------|
| 前端 | 31001 | 浏览器访问地址 |
| 后端服务 | 31002 | 提供 GPU 监控、技能管理等 API |

如需修改前端端口，在 `.env` 中添加 `FRONTEND_PORT=你的端口`。

---

## 📸 截图预览

> Dashboard 主界面 — 7 个 Agent 实时监控，含上下文用量进度条

![主界面](image.png)

> 点击 Agent 卡片展开详情，可查看对话历史、实时活动、技能配置、定时任务等

---

## 🛠️ 技术栈

| 分类 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Composition API |
| UI 组件库 | Element Plus |
| 状态管理 | Pinia |
| 构建工具 | Vite |
| 语言 | TypeScript |
| Markdown | Marked + highlight.js |
| 后端服务 | Node.js (原生 http 模块，无需额外框架) |

---

## 📁 项目结构

```
openclaw-dashboard/
├── src/
│   ├── components/
│   │   ├── AgentCard.vue          # Agent 状态卡片（含实时活动条）
│   │   ├── AgentDetailDrawer.vue  # 点击卡片展开的详情抽屉
│   │   ├── SkillsDialog.vue       # 技能库管理弹窗（含对比矩阵）
│   │   ├── VersionDialog.vue      # 版本管理弹窗
│   │   └── GatewayDoctorDialog.vue # 网关诊断弹窗
│   ├── stores/
│   │   ├── agent.ts               # Agent 状态管理
│   │   └── usage-stats.ts         # 用量统计
│   ├── views/
│   │   └── Dashboard.vue          # 主页面
│   └── api/
│       ├── gateway.ts             # OpenClaw Gateway API
│       └── system.ts              # 系统 API
├── scripts/
│   └── unified-service.js         # 后端服务（GPU/技能/版本管理等 API）
├── public/
│   └── avatars/                   # Agent 头像图片目录
├── .env.example                   # 环境变量示例
├── start.sh                       # 一键启动脚本（macOS/Linux）
└── start.bat                      # 一键启动脚本（Windows）
```

---

## ❓ 常见问题

**Q：页面空白 / 无法加载 Agent**

检查 `.env` 中的 `VITE_GATEWAY_URL` 是否正确，确认 OpenClaw Gateway 已启动（`openclaw gateway status`）。

**Q：Token 在哪里找？**

```bash
cat ~/.openclaw/openclaw.json | grep token
```

或者查看 OpenClaw 的 `openclaw.json` 配置文件，`gateway.token` 字段即为所需 Token。

**Q：GPU 显存显示不出来**

仅在本地跑 llama.cpp / Ollama 等推理服务时有意义。Dashboard 通过调用 `nvidia-smi` 获取数据，需要安装 NVIDIA 驱动。

**Q：如何添加自定义 Agent 头像？**

将图片文件命名为 `<agentId>.jpg` 或 `<agentId>.png`，放入 `public/avatars/` 目录，重启 Dashboard 即生效。

---

## 📋 版本历史

| 版本 | 说明 |
|------|------|
| v1.8.2 | 功能按钮区下移并放大：原顶部 7 个小按钮（网关/文件管理/计费配置/技能库/WebUI/通知/GPU/版本）下移到统计卡下方新增「功能区」，每个按钮带图标+主标题+副标题，显著放大；顶部状态栏简化为「品牌+时间+自定义布局」；自定义排序逻辑完全保留 |
| v1.8.1 | ① Token 详情「累计」改为「历史至今」并加 tooltip 说明（修改计费配置后实时按新单价重算所有历史用量）  ② 新增「自定义布局」对话框：顶部按钮顺序 + 统计卡片顺序均可拖拽/点击 ↑↓ 重排，配置持久化到 localStorage |
| v1.8.0 | Sprint 1 暖身打包（5 项）：① 通知中心铃铛+错误推送  ② Dashboard 顶部「今日/本月预估」副标题  ③ Token 详情顶部时段费用速览卡  ④ Agent 卡片双击进会话+自动聚焦输入  ⑤ 「正在做什么」气泡可切换显示完整 thinking 原文 |
| v1.7.1 | 文件管理增强：① 类别 / 分组标题可点击折叠 + 显示文件数  ② 每个文件 hover 时显示快捷按钮：在 Finder 中显示 / 用默认应用打开  ③ 右侧预览面板加打开按钮 |
| v1.7.0 | 新增「文件管理」模块：分类列出 ~/clawd 和 ~/.openclaw 所有关键文件，含中文译名、说明、谁在用、实时大小/修改时间；右侧预览（Markdown 渲染、JSON 格式化、敏感文件提示、目录列表）；左侧搜索 |
| v1.6.3 | 网关诊断结果中文解读：把英文输出（Doctor warnings / plugins.allow / symlink-escape / Missing requirements 等）翻译成中文条目卡片，原始英文输出折叠隐藏，可点击展开 |
| v1.6.2 | 网关诊断弹窗修复：超时 120s→180s、显示已运行秒数、暴露真实错误原因、新增「重新诊断」按钮、不再吞掉 axios 错误 |
| v1.6.1 | 计费配置只显示当前实际使用过的模型；订阅新模型并产生 token 用量后自动出现；Token 消耗详情表加 Agent 真实头像图片 |
| v1.6.0 | 按模型可编辑计费配置（顶部「计费配置」按钮）：支持包月订阅 / 按 token / 时段折扣 / 缓存价；内置 MiniMax 包月、DeepSeek 夜间半价、Claude、OpenAI 预设；配置持久化到 `billing-config.json` |
| v1.5.0 | 新增三种计费模式（electricity / subscription / api_only），支持订阅 API 月费按运行时长分摊；Token 详情筛选下拉 z-index 修复（el-dialog 内可正常弹出） |
| v1.4.2 | Token 消耗详情：各 Agent 明细表 Agent / 模型 列可筛选、Token / 费用 列可排序 |
| v1.4.1 | 技能对比矩阵图例移到顶部固定显示（绿点 / 橙点 / 灰点含义一目了然） |
| v1.4.0 | 右侧面板整体滚动（el-scrollbar 重构）、操作按钮固定底部不参与滚动、抽屉头像、技能分类点击折叠、Agent 列表去重、消息发送 API 重构（本地 CLI 代理替代 sessions_send）、心跳与英文思考内容自动过滤、修复运行中卡片无法点击的 Bug |
| v1.3.0 | 实时活动条与抽屉活动面板、技能对比矩阵、定时任务面板、Button 全面升级、上下文进度条覆盖所有 Agent |
| v1.2.x | 技能库内联面板、技能详情点击展开、运行状态检测优化 |
| v1.1.x | 多 Agent 头像支持、历史 Token 按模型拆分、费用统计 |
| v1.0.x | 初始版本，基础 Agent 状态监控 |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/your-feature`
3. 提交代码：`git commit -m 'feat: 添加某功能'`
4. 推送分支：`git push origin feat/your-feature`
5. 发起 Pull Request

---

## 📄 License

[MIT](LICENSE)

---

> 基于 [openclaw-dashboard](https://gitee.com/yaconit/openclaw-dashboard) 二次开发，感谢原作者的工作。
