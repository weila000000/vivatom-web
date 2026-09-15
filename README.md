# Vivatom Web

Vivatom 的 Vue 3 前端。它实现从自然语言需求到方案审批、源码快照、安全检查、Sandpack 隔离编译和不可变版本提交的软件生产工作台。

## Development

```bash
pnpm install
pnpm dev
```

默认地址为 `http://localhost:5173`，`/api` 会代理到 `http://localhost:8080`。

## Verification

```bash
pnpm test -- --run
pnpm build
```

