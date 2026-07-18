# Docker 资源

Phase 0 需要准备以下镜像：

- `sagemath/sagemath:latest`
- `qdrant/qdrant:latest`

Windows 默认使用 Docker Desktop。镜像拉取和容器启动验证应在 Docker daemon 可用后执行。

Phase 2 使用派生的 SageMath Kernel Gateway：

```powershell
docker compose -f docker\sagemath\compose.yaml build
docker compose -f docker\sagemath\compose.yaml up -d
docker compose -f docker\sagemath\compose.yaml ps
```

服务仅发布到 `127.0.0.1:8888`，容器位于禁止外联的 internal 网络。

Phase 4 starts Qdrant on `127.0.0.1:7333`. Port 6333 is inside a Windows excluded range on the development machine.

```powershell
docker compose -f docker\qdrant\compose.yaml up -d
docker compose -f docker\qdrant\compose.yaml ps
```
