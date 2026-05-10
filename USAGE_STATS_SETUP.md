# Usage Stats Service 启动指南

## ❌ 问题原因

**502 Bad Gateway** 错误的原因是 **usage-stats 服务（端口 3001）没有运行**。

Vite 开发服务器配置了代理：
```javascript
'/usage-stats': {
  target: 'http://localhost:3001',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/usage-stats/, ''),
}
```

但 usage-stats 服务需要手动启动。

---

## ✅ 解决方案

### 方法 1：使用启动脚本（推荐）

运行以下批处理文件：

```bash
start-usage-stats.bat
```

这个脚本会：
1. 检查 Node.js 是否安装
2. 启动 usage-stats 服务
3. 显示服务状态

---

### 方法 2：直接运行

```bash
node scripts/usage-stats.js
```

服务启动后会显示：
```
🦞 OpenClaw Usage Stats Service
   Port: 3001
   OpenClaw Dir: C:\Users\yc\.openclaw
   API: http://localhost:3001/api/usage
   Health: http://localhost:3001/api/health
```

---

### 方法 3：同时启动 Dashboard 和 Usage Stats

创建一个新的批处理文件 `start-all.bat`：

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo    OpenClaw Dashboard + Usage Stats
echo ========================================
echo.

REM 启动 usage-stats 服务（后台）
echo [启动] Usage Stats Service (端口 3001)
start "Usage Stats" node scripts/usage-stats.js

REM 等待 2 秒
timeout /t 2 /nobreak >nul

REM 启动 Dashboard
echo [启动] Dashboard (端口 3000)
call npm run dev
```

---

## 🧪 验证服务是否运行

### 方法 1：浏览器访问

打开浏览器访问：
- http://localhost:3001/api/usage
- http://localhost:3001/api/health

### 方法 2：使用测试页面

打开 `test-usage-stats.html` 文件，会自动测试 API 并显示结果。

### 方法 3：命令行测试

```bash
curl http://localhost:3001/api/usage
```

---

## 📊 预期响应

```json
{
  "totalTokens": 1250000,
  "totalCost": 3.45,
  "byAgent": {
    "main": {
      "tokens": 500000,
      "cost": 1.20,
      "sessionCount": 5
    },
    "backend": {
      "tokens": 750000,
      "cost": 2.25,
      "sessionCount": 3
    }
  },
  "updatedAt": "2026-05-10T12:00:00.000Z",
  "version": "2026.3.13"
}
```

---

## 🔧 常见问题

### Q1: 服务启动失败

**原因**: OpenClaw 数据目录不存在

**解决**: 确保已运行过 OpenClaw，数据目录存在：
```
C:\Users\yc\.openclaw\agents
```

### Q2: 返回空数据

**原因**: 没有 .jsonl 文件

**解决**: 确保 OpenClaw 已经运行并产生了会话数据

### Q3: 端口被占用

**解决**: 修改端口号
```bash
set USAGE_STATS_PORT=3002
node scripts/usage-stats.js
```

---

## 🛑 停止服务

按 `Ctrl+C` 停止 usage-stats 服务。

---

## 📝 服务特点

1. **自动缓存**: 10 秒缓存，避免频繁读取文件
2. **跨域支持**: 支持 CORS，允许 Dashboard 调用
3. **健康检查**: 提供 `/api/health` 端点
4. **按 Agent 分类**: 返回每个 Agent 的详细用量

---

## 🔗 相关文件

- [`scripts/usage-stats.js`](scripts/usage-stats.js) - Usage Stats 服务主程序
- [`start-usage-stats.bat`](start-usage-stats.bat) - Windows 启动脚本
- [`test-usage-stats.html`](test-usage-stats.html) - API 测试页面
- [`src/api/usage-stats.ts`](src/api/usage-stats.ts) - Dashboard API 封装

---

## ✅ 完成检查清单

- [ ] usage-stats 服务正在运行（端口 3001）
- [ ] Dashboard 正在运行（端口 3000）
- [ ] 访问 Dashboard 可以看到运行时间、TOKEN、费用等指标
- [ ] 没有 502 Bad Gateway 错误

---

现在，运行 `start-usage-stats.bat` 启动服务，然后刷新 Dashboard 页面即可！🚀
