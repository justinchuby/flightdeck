# Flightdeck CLI

从终端控制你的 AI 多 Agent 编队。

---

## 前置条件

- Node.js ≥ 20
- Flightdeck 服务正在运行（CLI 通过 HTTP 连接服务端）

---

## 安装

### 方式一：npm 全局安装（推荐）

```bash
npm install -g @flightdeck-ai/flightdeck
```

安装后 `flightdeckcli` 命令会自动加入 PATH，在任何目录下都能直接用：

```bash
flightdeckcli --help
```

### 方式二：从源码使用

```bash
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck
npm install
npm run build
```

然后在**项目根目录**下运行：

```bash
npx flightdeckcli --help
```

> **注意**：`npx` 方式必须在 `flightdeck/` 项目根目录下执行，因为 `flightdeckcli` 是 workspace 内部包。

如果你想在任意目录下使用，可以做一个全局链接：

```bash
cd flightdeck
npm link --workspace=packages/cli
```

之后在任何地方都可以直接运行 `flightdeckcli`。

---

## 连接服务端

CLI 需要连接正在运行的 Flightdeck 服务端。启动服务：

```bash
flightdeck --no-browser
```

默认连接 `http://localhost:3001`。如果服务端在其他地址：

```bash
# 通过命令行参数
flightdeckcli --url http://192.168.1.100:3001 health

# 或通过环境变量
export FLIGHTDECK_URL=http://192.168.1.100:3001
flightdeckcli health

# 或进入 REPL 后保存（只需设置一次）
flightdeckcli
◆ flightdeck ❯ config url http://192.168.1.100:3001
◆ flightdeck ❯ config token your-auth-token
```

配置保存在 `~/.flightdeckcli/session.json`，后续调用自动使用。

---

## 两种使用方式

### 1. 单条命令（适合脚本和自动化）

```bash
flightdeckcli <全局选项> <命令> <子命令> <参数>
```

### 2. 交互式 REPL（适合日常操作）

```bash
flightdeckcli
```

进入后直接输入命令（不需要再写 `flightdeckcli` 前缀）：

```
◆ flightdeck ❯ project list
◆ flightdeck ❯ agent list
◆ flightdeck ❯ quit
```

---

## 全局选项

```bash
flightdeckcli --json project list    # JSON 输出（适合脚本/jq 处理）
flightdeckcli --project abc123 agent list   # 限定到某个项目
flightdeckcli --url http://x:3001 health    # 指定服务器地址
flightdeckcli --token mytoken health        # 指定认证令牌
flightdeckcli --version                     # 显示版本
flightdeckcli --help                        # 显示帮助
```

---

## 命令参考

> 下面每条命令都展示完整写法。
> 如果你是通过源码安装的，把 `flightdeckcli` 替换成 `npx flightdeckcli`。

### 🔍 系统状态

**检查服务器是否在线**
```bash
flightdeckcli health
```

**查看全局编排状态（Agent 数量、锁、活动）**
```bash
flightdeckcli status
```

**查看已安装的 AI 提供商**
```bash
flightdeckcli providers
```

**查看可用的 Agent 角色**
```bash
flightdeckcli roles
```

**查看最近活动日志**
```bash
flightdeckcli activity
flightdeckcli activity --limit 50
```

**查看分析概览（token 用量、成本）**
```bash
flightdeckcli analytics
```

**查看编排摘要**
```bash
flightdeckcli summary
```

**查看文件锁定情况**
```bash
flightdeckcli locks
```

---

### 📁 项目管理

**列出所有项目**
```bash
flightdeckcli project list
flightdeckcli project list --status active
```

**创建并启动新项目**
```bash
flightdeckcli project start "实现用户登录功能"
flightdeckcli project start "Build REST API" --name my-api --model claude-opus-4.6
```

**查看项目详情**
```bash
flightdeckcli project info abc123def456
```

**设为当前活跃项目（后续命令自动关联到这个项目）**
```bash
flightdeckcli project use abc123def456
```

**删除项目**
```bash
flightdeckcli project delete abc123def456
```

---

### 🤖 Agent 管理

**列出所有 Agent**
```bash
flightdeckcli agent list
```

**创建新 Agent**
```bash
flightdeckcli agent spawn developer
flightdeckcli agent spawn architect --model claude-opus-4.6 --task "设计数据库架构"
```

**向 Agent 发送消息**
```bash
flightdeckcli agent message a1b2c3d4 "请加上输入验证"
```

**查看 Agent 的消息历史**
```bash
flightdeckcli agent messages a1b2c3d4
flightdeckcli agent messages a1b2c3d4 --limit 100
```

**中断 Agent 当前操作**
```bash
flightdeckcli agent interrupt a1b2c3d4
```

**重启 Agent**
```bash
flightdeckcli agent restart a1b2c3d4
```

**终止 Agent**
```bash
flightdeckcli agent terminate a1b2c3d4
```

---

### 📋 任务 DAG

**列出所有任务**
```bash
flightdeckcli task list
flightdeckcli task list --status running
flightdeckcli task list --scope project
```

**查看任务统计**
```bash
flightdeckcli task stats
```

**查看需要人工关注的任务**
```bash
flightdeckcli task attention
```

---

### ✅ 决策管理

**列出待审批的决策**
```bash
flightdeckcli decision list
flightdeckcli decision list --all
```

**批准决策**
```bash
flightdeckcli decision approve abc123
flightdeckcli decision approve abc123 --reason "方案合理，同意执行"
```

**拒绝决策**
```bash
flightdeckcli decision reject abc123 --reason "安全风险太高"
```

---

## JSON 输出

所有命令加 `--json` 输出 JSON，方便脚本处理：

```bash
flightdeckcli --json agent list
flightdeckcli --json task stats
flightdeckcli --json project list

# 配合 jq
flightdeckcli --json agent list | jq '.[] | select(.status == "active")'
flightdeckcli --json task stats | jq '.done'
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `FLIGHTDECK_URL` | 服务器地址（默认 `http://localhost:3001`） |
| `FLIGHTDECK_TOKEN` | 认证令牌 |
| `NO_COLOR` | 设为任意值禁用彩色输出 |
