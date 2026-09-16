# Vivatom Web

Vivatom 的 Vue 3 前端。它实现从自然语言需求到方案审批、源码快照、安全检查、Sandpack 隔离编译和不可变版本提交的软件生产工作台。

## Development

```bash
pnpm install
pnpm dev
```

默认地址为 `http://localhost:5173`，`/api` 会代理到 `http://localhost:8080`。

也可以执行 `./scripts/dev.sh`。GoLand 或 IntelliJ IDEA 单独打开前端项目后，选择共享运行项 `Vivatom Frontend`；macOS 使用 `Control + R`，Windows/Linux 使用 `Shift + F10`。后端在另一个 IDE 窗口打开 `../vivatom-api-svc`，运行 `Vivatom Backend`。

## Verification

```bash
pnpm test -- --run
pnpm build
```
