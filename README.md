# sweet-auto-register

一个基于 `puppeteer-real-browser` 的自动化项目，包含：
- 注册流程
- 授权流程
- CPA token 文件同步

## 环境要求

- Node.js 18+
- npm
- 本机可正常启动 Chrome / Chromium

安装依赖：

```bash
npm install
```

## 目录说明

- `auth/register/`
  - 注册成功后生成的账号文件
  - 授权流程会从这里读取账号
- `auth/cpa/`
  - 授权成功后生成的 token 文件
  - `npm run sync` 会上传这里的文件
- `auth/phone/current.json`
  - 当前复用中的手机号状态
- `auth/hao/`
  - 外部来源的 token 原始文件，可手动转换为 `auth/cpa` 格式
- `src/`
  - 项目源码

## 配置文件

项目从根目录 `config.json` 读取配置。

可以参考下面这个结构：

```json
{
  "browser": {
    "provider": "real-browser",
    "turnstile": false,
    "challengeTimeoutMs": 60000,
    "useChrome": true,
    "chromePath": "",
    "headless": false,
    "keepOpen": true,
    "viewport": {
      "width": 1280,
      "height": 900
    },
    "proxy": {
      "host": "",
      "port": 0,
      "username": "",
      "password": ""
    }
  },
  "startUrl": "https://example.com",
  "readyText": "",
  "mail": {
    "baseUrl": "",
    "adminPassword": "",
    "sitePassword": "",
    "domain": "",
    "pollIntervalMs": 5000,
    "maxAttempts": 30
  },
  "sms": {
    "provider": "hero-sms",
    "heroSms": {
      "apiKey": "",
      "service": "dr",
      "countries": [
        {
          "browserOptionKey": "TH",
          "browserDialCode": "+66",
          "providerCountry": 16,
          "maxPrice": 0.067
        }
      ]
    },
    "fiveSim": {
      "apiKey": "",
      "product": "",
      "countries": [
        {
          "browserOptionKey": "TH",
          "browserDialCode": "+66",
          "providerCountry": "any",
          "providerOperator": "any"
        }
      ]
    },
    "pollIntervalMs": 5000,
    "maxAttempts": 60,
    "numberMaxRetries": 5
  },
  "sync": {
    "enabled": false,
    "host": "",
    "port": 22,
    "username": "",
    "password": "",
    "remotePath": ""
  },
  "oauth": {
    "clientId": "YOUR_OAUTH_CLIENT_ID",
    "authorizeUrl": "https://your-oauth-domain.example.com/oauth/authorize",
    "tokenUrl": "https://your-oauth-domain.example.com/oauth/token",
    "redirectHost": "127.0.0.1",
    "redirectPort": 1455,
    "redirectPath": "/auth/callback",
    "scope": "openid profile email offline_access"
  }
}
```

## 常用命令

### 1. 主流程

```bash
npm start
```

默认执行 1 次完整流程。

也可以指定次数：

```bash
npm start 3
```

当前主流程逻辑在 `src/app/AppRunner.ts:40`：
- 每轮先执行注册
- 再执行授权

## 注册与授权产物

### 注册产物

注册成功后，会在 `auth/register/` 下生成账号文件。

### 授权产物

授权成功后，会在 `auth/cpa/` 下生成：

```text
codex-<email>-free.json
```

例如：

```text
auth/cpa/codex-user@example.com-free.json
```

文件结构是项目内部使用的 `OAuthTokenResponse` 结构，包含：
- `access_token`
- `account_id`
- `disabled`
- `email`
- `expired`
- `id_token`
- `last_refresh`
- `refresh_token`
- `type`

## 同步 CPA 文件

把 `auth/cpa/` 下的 JSON 文件上传到远端服务器：

```bash
npm run sync
```

使用前需要先在 `config.json` 里配置：

```json
{
  "sync": {
    "enabled": true,
    "host": "你的服务器地址",
    "port": 22,
    "username": "你的用户名",
    "password": "你的密码",
    "remotePath": "/你的目标目录"
  }
}
```

当前同步逻辑：
- 扫描 `auth/cpa/*.json`
- 连接远端 SFTP
- 自动创建远端目录
- 逐个上传文件
- 上传成功后删除本地文件
- 失败时停止并保留未成功上传的本地文件

入口文件：`src/app/runSyncCpa.ts:5`

## 类型检查

```bash
npm run check
```

会执行：

```bash
tsc --noEmit
```

## 其他调试命令

### 邮箱验证码调试

```bash
npm run mail:code
```

### 短信验证码调试

```bash
npm run sms:code
```

### OAuth 回调调试

```bash
npm run callback
```

说明：当前 `src/app/runAuthorizationCallbackTest.ts:4` 里使用的是写死的测试回调地址，主要用于开发调试，不是通用命令行版本。

## 使用建议

推荐日常使用顺序：

1. 配好 `config.json`
2. 执行主流程：

```bash
npm start 1
```

3. 检查 `auth/cpa/` 是否生成 token 文件
4. 如需上传，执行：

```bash
npm run sync
```

## 注意事项

- `sync` 当前使用的是账号密码方式上传，密码保存在 `config.json` 中。
- `npm run sync` 上传成功后会删除本地 `auth/cpa` 文件。
- 如果 `auth/register/` 没有可用账号，授权流程会自动跳过。
- 如果 `auth/cpa/` 为空，`npm run sync` 会直接跳过。
