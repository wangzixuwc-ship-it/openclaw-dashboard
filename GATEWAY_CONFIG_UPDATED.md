# ✅ Gateway 配置已更新

## 已完成的修改

已修改 `C:\Users\yc\.openclaw\openclaw.json` 配置文件：

### 1. 添加 CORS 允许的来源
```json
"allowedOrigins": [
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]
```

现在 Dashboard（端口 5173）和原来的控制 UI（端口 3000）都可以访问 Gateway。

### 2. 启用所有工具
```json
"tools": {
  "enabled": ["*"]
}
```

这会启用所有 Gateway 工具，包括：
- ✅ `sessions_list` - 获取会话列表
- ✅ `sessions_history` - 获取会话历史
- ✅ `sessions_send` - 发送消息到会话（用于重置）
- ✅ `session_status` - 获取会话状态
- ✅ `agents_list` - 获取 Agent 列表
- ✅ 以及所有其他可用工具

### 3. 保持设备认证禁用
```json
"dangerouslyDisableDeviceAuth": true
```

这在开发环境下是安全的，可以避免设备配对的麻烦。

## 下一步操作

### 重启 Gateway

配置修改后，需要重启 Gateway 才能生效：

1. **停止当前的 Gateway**（如果正在运行）
   - 在运行 Gateway 的终端窗口按 `Ctrl+C`
   - 或者关闭终端窗口

2. **重新启动 Gateway**
   ```bash
   openclaw gateway
   ```

3. **验证配置已加载**
   
   打开浏览器访问：
   ```
   http://localhost:18789/health
   ```
   
   应该看到类似这样的响应：
   ```json
   {
     "status": "ok",
     "port": 18789,
     "version": "2026.3.13"
   }
   ```

### 测试 sessions_send 工具

重启后，可以用 curl 测试 `sessions_send` 工具是否可用：

```bash
curl -X POST http://localhost:18789/tools/invoke ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer 1ffc5e5f86af6565af0dca8e3bfc90dea4f837f7fb4a86c5" ^
  -d "{\"tool\":\"sessions_send\",\"action\":\"json\",\"args\":{\"sessionKey\":\"agent:recorder:main\",\"message\":\"/reset\",\"timeoutSeconds\":0}}"
```

如果返回 `{"ok":true,...}` 说明工具已启用 ✅

### 测试 Dashboard

1. 确保 Dashboard 正在运行：
   ```bash
   npm run dev
   ```

2. 打开浏览器访问：`http://localhost:5173`

3. 点击任意 Agent 卡片

4. 点击"重置会话"按钮

5. 如果看到成功提示，说明配置完全正确！🎉

## 配置说明

### 为什么需要这些修改？

| 配置项 | 原因 |
|--------|------|
| `allowedOrigins` | 允许 Dashboard 的跨域请求 |
| `tools.enabled: ["*"]` | 明确启用所有工具，包括 `sessions_send` |
| `dangerouslyDisableDeviceAuth` | 开发环境下简化认证流程 |

### 安全提示

⚠️ **重要**：
- `dangerouslyDisableDeviceAuth: true` 仅用于开发环境
- 生产环境应该：
  - 移除或设置为 `false`
  - 使用设备配对认证
  - 配置适当的 CORS 白名单
  - 使用 HTTPS

## 故障排除

### 问题 1：重启后仍然报错

**解决方案**：
1. 确认 Gateway 完全停止（检查进程）
2. 检查配置文件语法是否正确
3. 查看 Gateway 启动日志，确认配置已加载

### 问题 2：CORS 错误

如果浏览器控制台显示 CORS 错误：

1. 确认 Dashboard 访问的是 `http://localhost:5173` 或 `http://127.0.0.1:5173`
2. 清除浏览器缓存
3. 重启浏览器

### 问题 3：工具仍然不可用

检查 Gateway 启动日志，看是否有工具加载错误。如果问题持续：

1. 查看 OpenClaw 版本：`openclaw --version`
2. 确认 `sessions_send` 工具在该版本中可用
3. 查看官方文档或提交 Issue

## 配置文件备份

修改前的配置已自动备份为：
```
C:\Users\yc\.openclaw\openclaw.json.last-good
```

如果需要恢复，可以复制这个文件。

---

**更新时间**: 2026-05-10  
**配置版本**: OpenClaw 2026.3.13
