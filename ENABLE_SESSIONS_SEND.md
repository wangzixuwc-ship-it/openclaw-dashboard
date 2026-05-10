# 启用 sessions_send 工具配置指南

## 重要提示

**Gateway 配置文件不在 Dashboard 项目中**，而是在你的 OpenClaw Gateway 安装目录中。

## 找到 Gateway 配置

### 方法 1：查找常见位置

Gateway 配置文件通常位于以下位置之一：

```
# Windows
C:\Users\你的用户名\.openclaw\gateway.config.yaml
C:\Program Files\OpenClaw\config\gateway.yaml
你的 OpenClaw 安装目录\config\gateway.yaml

# macOS/Linux
~/.openclaw/gateway.config.yaml
/etc/openclaw/gateway.yaml
```

### 方法 2：通过启动命令查找

如果你是通过命令行启动 Gateway，配置文件路径可能在启动命令中指定：

```bash
# 示例
openclaw gateway --config /path/to/gateway.config.yaml
```

### 方法 3：查看正在运行的 Gateway 进程

```bash
# Windows PowerShell
Get-Process | Where-Object {$_.ProcessName -like "*openclaw*"}

# 或查看启动脚本
# 检查你的 start.bat 或类似的启动文件
```

## 配置示例

找到配置文件后，添加或修改以下配置：

### 完整配置示例

```yaml
# gateway.config.yaml

# Gateway 基本配置
gateway:
  # 服务端口
  port: 18789
  
  # 认证配置
  controlUi:
    # 开发环境：禁用设备认证（不推荐生产环境）
    dangerouslyDisableDeviceAuth: true
    
    # 或者指定允许的令牌
    # allowedTokens:
    #   - "your-token-here"
  
  # 工具配置 - 关键部分
  tools:
    # 方式 1：启用所有工具
    enabled:
      - "*"
    
    # 方式 2：明确指定启用的工具
    # enabled:
    #   - sessions_list
    #   - sessions_history
    #   - sessions_send      # ← 必须启用这个
    #   - session_status
    #   - agents_list
    #   - health
    
    # 工具权限配置（可选）
    # permissions:
    #   sessions_send:
    #     scopes:
    #       - operator.write
  
  # CORS 配置（允许 Dashboard 访问）
  cors:
    allowedOrigins:
      - "http://localhost:5173"    # Vite 默认端口
      - "http://127.0.0.1:5173"
  
  # 日志配置
  logging:
    level: info  # debug, info, warn, error

# 会话管理配置
sessions:
  # 最大并发会话数
  maxConcurrent: 10
  
  # 会话超时时间（分钟）
  timeoutMinutes: 30

# 模型配置（根据你的实际配置）
models:
  default: gpt-4
  # 添加你的模型配置
```

### 最小配置示例

如果你只需要启用 `sessions_send`，最小配置如下：

```yaml
gateway:
  port: 18789
  controlUi:
    dangerouslyDisableDeviceAuth: true
  tools:
    enabled:
      - "*"
```

## 应用配置

### 步骤 1：编辑配置文件

使用文本编辑器打开 Gateway 配置文件：

```bash
# 示例（使用 VS Code）
code C:\path\to\gateway.config.yaml
```

### 步骤 2：添加/修改配置

确保配置中包含：

```yaml
gateway:
  tools:
    enabled:
      - "*"
```

或者至少包含：

```yaml
gateway:
  tools:
    enabled:
      - sessions_send
```

### 步骤 3：保存并重启 Gateway

```bash
# 停止 Gateway（如果正在运行）
# Ctrl+C 或关闭终端窗口

# 重新启动 Gateway
openclaw gateway --config /path/to/gateway.config.yaml
```

### 步骤 4：验证配置

1. 打开浏览器访问：`http://localhost:18789/health`
   - 应该看到健康检查响应

2. 打开 Dashboard：`http://localhost:5173`

3. 点击任意 Agent 卡片

4. 点击"重置会话"按钮

5. 如果看到成功提示，说明配置正确 ✅

## 故障排除

### 问题 1：找不到配置文件

**解决方案**：创建一个新的配置文件

```bash
# 在 Gateway 启动目录创建
echo "gateway:
  port: 18789
  tools:
    enabled:
      - \"*\"
" > gateway.config.yaml

# 然后用这个配置启动
openclaw gateway --config gateway.config.yaml
```

### 问题 2：配置后仍然报错

**可能原因**：
- Gateway 没有重新加载配置
- 配置文件路径错误
- YAML 格式错误

**解决方案**：
1. 确保完全停止并重启 Gateway（不只是重新加载）
2. 检查 YAML 语法（使用 [YAML Lint](https://www.yamllint.com/)）
3. 查看 Gateway 启动日志，确认配置已加载

### 问题 3：权限错误

如果看到 `missing scope: operator.write`：

**解决方案 A**（开发环境）：
```yaml
gateway:
  controlUi:
    dangerouslyDisableDeviceAuth: true
```

**解决方案 B**（生产环境）：
```bash
# 批准设备配对
openclaw devices approve --latest
```

## 验证工具是否可用

配置完成后，可以用 curl 测试：

```bash
# 测试 sessions_send 工具
curl -X POST http://localhost:18789/tools/invoke \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d "{
    \"tool\": \"sessions_send\",
    \"action\": \"json\",
    \"args\": {
      \"sessionKey\": \"agent:main:main\",
      \"message\": \"/reset\",
      \"timeoutSeconds\": 0
    }
  }"
```

如果返回 `{"ok":true,...}` 说明工具已启用 ✅
如果返回 `{"ok":false,"error":{"type":"not_found",...}}` 说明工具未启用 ❌

## 常用配置组合

### 开发环境配置

```yaml
gateway:
  port: 18789
  controlUi:
    dangerouslyDisableDeviceAuth: true
  tools:
    enabled:
      - "*"
  cors:
    allowedOrigins:
      - "http://localhost:*"
  logging:
    level: debug
```

### 生产环境配置

```yaml
gateway:
  port: 18789
  controlUi:
    # 不禁用认证，使用设备配对
    allowedTokens:
      - "your-secure-token-here"
  tools:
    enabled:
      - sessions_list
      - sessions_history
      - sessions_send
      - session_status
      - agents_list
  cors:
    allowedOrigins:
      - "https://your-domain.com"
  logging:
    level: warn
```

## 需要帮助？

如果以上步骤都无法解决问题，请提供：

1. Gateway 版本号：`openclaw --version`
2. Gateway 启动命令
3. 配置文件内容（移除敏感信息）
4. 完整的错误信息

这样可以获得更精准的帮助。
