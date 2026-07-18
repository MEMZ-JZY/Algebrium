# Heartbeat 任务

六个 Heartbeat 任务映射到 Curator CLI。人工验收后再注册 Windows Task Scheduler；主 Agent 不得调用这些写命令。

| 任务 | Curator 命令 | 建议频率 |
| --- | --- | --- |
| 知识搜集 | `collect` | 6 小时 |
| 索引刷新 | `index-refresh` | 每天 |
| 语料清洗 | `cleanup` | 每周 |
| 难度校准 | `difficulty` | 每月 |
| 健康自检 | `health` | 30 分钟 |
| 定理图重构 | `graph-rebuild` | 两周 |
