# DuMate 反代

把已登录的 DuMate 桌面端本机接口转换为 OpenAI 兼容 `/v1`。OpenClaw、Magpie、Codex、脚本和 OpenAI SDK 可直接接入。

[**在线教程**](https://LeeSan1.github.io/dumate2api/) · [快速开始](#快速开始) · [模型](#模型映射) · [排错](#常见问题)

> 本项目复用本机桌面客户端的登录态，不包含账户密钥，不绕过登录或会员权限。代理默认只监听 `127.0.0.1`，请按 DuMate 服务条款使用。

## 工作原理

```text
客户端 / OpenAI SDK
        │  http://127.0.0.1:3066/v1
        ▼
DuMate 反代
        │  动态发现本机端口与临时密钥
        ▼
DuMate 桌面端 → /api/qianfanproxy/v1
```

代理会自动查找本机正在运行的 `dumate-main-server`，读取其动态端口和 `DUMATE_INAPP_KEY`，再把标准 OpenAI 请求转发到 DuMate 的本地兼容接口。临时密钥只留在内存里，不写入文件，也不会出现在日志中。

## 快速开始

要求：

- macOS 或 Windows
- Node.js 18+
- 已安装并登录百度搭子 DuMate

先启动 DuMate，再运行代理：

```bash
git clone https://github.com/LeeSan1/dumate2api.git
cd dumate2api
./run.sh
```

macOS 也可以双击 `start.command`；Windows 使用 `npm start` 或 `run.bat`。项目没有第三方依赖，不需要 `npm install`。

默认地址是 `http://127.0.0.1:3066`。如果端口已被 Magpie、Codex Router 或其他程序占用，换一个端口：

```bash
./run.sh --port 3067
```

然后验证：

```bash
curl http://127.0.0.1:3067/healthz
curl http://127.0.0.1:3067/v1/models
```

健康检查应返回 `{"ok":true,"service":"dumate-openai-proxy"}`。

## 支持的模型别名

| 代理模型 | DuMate 上游模型 |
|---|---|
| `dumate-glm-5` | `model-text` |
| `dumate-deepseek-v4-flash-0731` | `deepseek-v4-flash-0731` |
| `dumate-deepseek-v4-pro` | `deepseek-v4-pro` |
| `dumate-deepseek-v41-flash` | `deepseek-v41-flash` |

代理同时接受带 provider 前缀的写法，例如 `dumate-local/dumate-deepseek-v41-flash`。
`deepseek-v4.1-flash` 和 `deepseek-v4-1-flash` 也会自动归一到同一个 DuMate 模型。

## 调用示例

```bash
curl http://127.0.0.1:3067/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-test' \
  -d '{
    "model": "dumate-deepseek-v41-flash",
    "messages": [{"role": "user", "content": "只回复 OK"}]
  }'
```

`Authorization` 只需要满足 OpenAI 客户端的格式，可填任意占位值。代理会把它替换为 DuMate 本地上游所需的鉴权头。

OpenAI JS SDK：

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:3067/v1",
  apiKey: "local-test",
});

const response = await client.chat.completions.create({
  model: "dumate-deepseek-v41-flash",
  messages: [{ role: "user", content: "只回复 OK" }],
});

console.log(response.choices[0].message.content);
```

## 接入 OpenClaw / Magpie

```json
{
  "baseUrl": "http://127.0.0.1:3067/v1",
  "apiKey": "local-test",
  "models": [
    { "id": "dumate-deepseek-v41-flash" },
    { "id": "dumate-deepseek-v4-pro" },
    { "id": "dumate-deepseek-v4-flash-0731" },
    { "id": "dumate-glm-5" }
  ]
}
```

## 配置

复制 `.env.example` 为 `.env` 后按需设置环境变量，代理启动时会自动读取 `.env`（已有系统环境变量优先）。常用项：

```bash
DUMATE_PROXY_PORT=3067
DUMATE_PROXY_HOST=127.0.0.1
DUMATE_UPSTREAM_PREFIX=/api/qianfanproxy/v1
```

在 macOS 上，代理通常能自动发现 DuMate。如果某个版本无法被发现，可以在本机临时显式指定：

```bash
DUMATE_BACKEND_PORT=12345 \
DUMATE_INAPP_KEY='只在本机环境变量中提供' \
./run.sh
```

不要把真实的 `DUMATE_INAPP_KEY` 写进 `.env` 后提交，也不要把代理绑定到公网。默认只路由带 `dumate-`、`baidu-` 或 `qianfan-` 前缀的模型名；如确实需要路由裸模型名，可设置 `DUMATE_ROUTE_BARE_MODELS=1`。

## 常见问题

- **`503 dumate_unavailable`**：确认 DuMate 已启动并登录；若自动发现失败，按上面的方式显式提供本机端口和临时密钥。
- **端口冲突或 `/healthz` 返回其他服务的 404**：`3066` 可能已被 Magpie 或 Codex Router 占用，使用 `./run.sh --port 3067` 后把客户端 Base URL 一起改成 `3067`。
- **`unsupported_model`**：使用本文列出的 `dumate-*` 模型名，或设置 `DUMATE_ROUTE_BARE_MODELS=1`。
- **Windows 无法自动发现**：使用环境变量显式指定 `DUMATE_BACKEND_PORT` 和 `DUMATE_INAPP_KEY`。
- **客户端关闭后还能用吗**：不能。代理依赖桌面客户端提供的本地兼容接口，客户端必须保持运行并登录。

## 开发与测试

项目无第三方运行时依赖：

```bash
npm test
```

测试会启动一个本地假上游，验证模型别名转换、请求路径、鉴权头清理和不支持模型的拒绝逻辑，不会访问网络或真实 DuMate 账户。

## 安全边界

- 默认绑定回环地址，避免局域网或公网任意调用。
- 代理不会把动态 DuMate 密钥写入磁盘或日志。
- `DUMATE_INAPP_KEY` 只适合本机临时调试，不能提交到 Git。
- 如果需要远程访问，请在代理前增加认证、TLS 和访问控制；本项目本身不提供公网鉴权。
- 项目当前只使用桌面端已登录的那一个账户，不包含账号池、自动签到或绕过会员限制的能力。

## License

[MIT](LICENSE)
