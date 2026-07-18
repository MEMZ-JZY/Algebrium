# 索引刷新

运行 `bun run curator index-refresh`，为 SQLite 中全部有效条目重建 Qdrant 向量。Qdrant 不可达或维度不一致时必须失败退出。
