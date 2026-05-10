# 说明
这是一个基于 Vue 3 + Element Plus 的 OpenClaw 系统监控 Dashboard。
它通过 OpenClaw 系统的 API 实时获取数据，显示 OpenClaw 系统的 Agent 状态、运行时间、错误信息等。
用户可以通过该界面监控 OpenClaw 系统的运行状态。
必须先启动 OpenClaw 系统，才能使用该 Dashboard。

# 系统界面

![alt text](Snipaste_2026-05-08_19-47-30.jpg)

# 启动

运行 `start.bat` 即可启动。

# 配置
在 `.env` 文件中配置 OpenClaw 系统的 API 地址、Token、电费单价、OpenClaw 版本、Agent 中文称呼等。
请参考 [env.example](.env.example)。
如果需要自定义 Agent 中文称呼，需要在 `.env` 文件中添加对应的变量名，格式为 `VITE_AGENT_<id>=<中文名称>`（id 中连字符用下划线替换）。