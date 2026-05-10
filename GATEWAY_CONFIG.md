# Gateway 配置指南

## 问题：sessions_send 工具不可用

当你看到错误 `Tool not available: sessions_send` 时，说明 Gateway 没有启用 `sessions_send` 工具。

## 解决方案

### 方案 1：启用 sessions_send 工具

在你的 Gateway 配置文件中，确保启用了 `sessions_send` 工具。

**配置文件位置**（根据你的 Gateway 版本可能不同）：
- `gateway.config.yaml`
- `config.yaml`
- 或在启动命令中指定

**配置示例**：
```yaml
gateway:
  tools:
    enabled:
      - sessions_list
      - sessions_history
      - sessions_send    # ← 确保这一行存在
      - session_status
      - agents_list
  
  # 或者使用通配符
  tools:
    enabled:
      - "*"              # ← 启用所有工具
```

### 方案 2：禁用设备认证（开发环境推荐）

在 Gateway 配置中添加：

```yaml
gateway:
  controlUi:
    dangerouslyDisableDeviceAuth: true
```

这个配置会：
- 禁用设备认证检查
- 允许 Dashboard 直接调用 Gateway 工具
- **仅建议在开发/测试环境使用**

### 方案 3：批准设备配对（生产环境推荐）

如果你不想禁用认证，可以手动批准 Dashboard 的设备配对请求：

```bash
# 使用 OpenClaw CLI 批准最新的设备配对
openclaw devices approve --latest
```

或者查看所有待批准的设备：

```bash
openclaw devices list
openclaw devices approve <device-id>
```

## 验证配置

配置修改后，重启 Gateway，然后在 Dashboard 中测试重置功能。

### 测试步骤：

1. 打开 Dashboard
2. 点击任意 Agent 卡片查看详情
3. 点击"重置会话"按钮
4. 如果看到成功提示，说明配置正确

## 错误信息参考

### 常见错误及解决方案：

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `Tool not available: sessions_send` | 工具未启用 | 在配置中启用 sessions_send |
| `missing scope: operator.write` | 权限不足 | 禁用设备认证或批准设备配对 |
| `Unauthorized` | 认证失败 | 检查 Bearer Token 是否正确 |
| `Connection refused` | Gateway 未启动 | 启动 Gateway 服务 |

## 环境变量配置

如果你使用环境变量配置 Gateway，确保设置：

```bash
# Gateway 地址
VITE_GATEWAY_URL=http://localhost:18789

# 认证 Token（如果需要）
VITE_GATEWAY_TOKEN=your-token-here
```

## 安全提示

⚠️ **重要**：
- `dangerouslyDisableDeviceAuth: true` 仅用于开发环境
- 生产环境请使用设备配对认证
- 不要在公开网络暴露 Gateway 端口（默认 18789）
