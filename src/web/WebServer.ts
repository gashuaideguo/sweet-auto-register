import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { CONFIG_PATH, loadConfig, saveConfig } from '../config/loadConfig.js';
import { ConfigValidationError } from '../config/validateConfig.js';
import type { AppConfig } from '../config/types.js';
import { getRecentLogs, logger } from '../shared/logger.js';
import { type ActiveJob, getServiceStatus } from './status.js';

type WebServerOptions = {
  host?: string;
  port?: number;
};

type SecretState = {
  browserProxyPassword: boolean;
  mailAdminPassword: boolean;
  mailSitePassword: boolean;
  heroSmsApiKey: boolean;
  fiveSimApiKey: boolean;
  syncPassword: boolean;
};

type SecretKey = keyof SecretState;

type RunningJob = Exclude<ActiveJob, null> & {
  process: ChildProcess;
};

const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

export class WebServer {
  private readonly host: string;
  private readonly port: number;
  private readonly server: http.Server;
  private activeJob: RunningJob | null = null;

  constructor(options: WebServerOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[Web] 请求处理失败：${message}`);
        this.sendJson(response, 500, { error: 'internal server error' });
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${this.host}:${this.port}`);

    if (request.method === 'GET' && url.pathname === '/') {
      this.sendHtml(response, this.renderPage());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/config') {
      this.sendHtml(response, this.renderConfigPage());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      this.sendJson(response, 200, getServiceStatus(this.getPublicActiveJob()));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/logs') {
      const after = Number(url.searchParams.get('after') ?? '0');
      const entries = getRecentLogs(Number.isFinite(after) ? after : 0);
      const lastId = entries.at(-1)?.id ?? (Number.isFinite(after) ? after : 0);
      this.sendJson(response, 200, { entries, lastId });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      this.sendJson(response, 200, this.getEditableConfigResponse());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/config/secret') {
      this.sendConfigSecret(url, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/config') {
      await this.saveConfigRequest(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/automation/start') {
      await this.startAutomation(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/sync/start') {
      await this.startSync(response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/task/stop') {
      this.stopActiveJob(response);
      return;
    }

    this.sendJson(response, 404, { error: 'not found' });
  }

  private async startAutomation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.activeJob) {
      this.sendJson(response, 409, { error: '已有任务正在运行', activeJob: this.getPublicActiveJob() });
      return;
    }

    const body = await this.readJsonBody(request);
    const accountCount = Number((body as { accountCount?: unknown }).accountCount);
    if (!Number.isInteger(accountCount) || accountCount < 1 || accountCount > 20) {
      this.sendJson(response, 400, { error: 'accountCount 必须是 1 到 20 的整数' });
      return;
    }

    const job = this.startChildJob('automation', ['tsx', 'src/main.ts', String(accountCount)]);
    logger.info(`[Web] 已启动自动化任务。accountCount=${accountCount} pid=${job.process.pid}`);

    this.sendJson(response, 202, { accepted: true, job: this.toPublicJob(job) });
  }

  private async startSync(response: ServerResponse): Promise<void> {
    if (this.activeJob) {
      this.sendJson(response, 409, { error: '已有任务正在运行', activeJob: this.getPublicActiveJob() });
      return;
    }

    const config = loadConfig();
    if (!config.sync.enabled) {
      this.sendJson(response, 400, { error: 'sync 未启用，请先在 config.yaml 中启用 sync.enabled' });
      return;
    }

    const job = this.startChildJob('sync', ['tsx', 'src/app/runSyncCpa.ts']);
    logger.info(`[Web] 已启动 CPA 同步任务。pid=${job.process.pid}`);

    this.sendJson(response, 202, { accepted: true, job: this.toPublicJob(job) });
  }

  private async saveConfigRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJsonBody(request) as Partial<AppConfig>;
    const current = loadConfig();
    const input = this.mergeSecrets(current, body);

    try {
      saveConfig(input);
      logger.info(`[Web] 配置已保存到 ${CONFIG_PATH}`);
      this.sendJson(response, 200, this.getEditableConfigResponse());
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        this.sendJson(response, 400, { error: '配置校验失败', errors: error.errors });
        return;
      }
      throw error;
    }
  }

  private getEditableConfigResponse(): { config: AppConfig; secrets: SecretState; configPath: string } {
    const config = loadConfig();
    const sanitized: AppConfig = {
      ...config,
      browser: {
        ...config.browser,
        proxy: {
          ...config.browser.proxy,
          password: this.maskSecret(config.browser.proxy.password),
        },
      },
      mail: {
        ...config.mail,
        adminPassword: this.maskSecret(config.mail.adminPassword),
        sitePassword: this.maskSecret(config.mail.sitePassword),
      },
      sms: {
        ...config.sms,
        heroSms: {
          ...config.sms.heroSms,
          apiKey: this.maskSecret(config.sms.heroSms.apiKey),
        },
        fiveSim: {
          ...config.sms.fiveSim,
          apiKey: this.maskSecret(config.sms.fiveSim.apiKey),
        },
      },
      sync: {
        ...config.sync,
        password: this.maskSecret(config.sync.password),
      },
    };

    return {
      config: sanitized,
      secrets: {
        browserProxyPassword: config.browser.proxy.password.trim().length > 0,
        mailAdminPassword: config.mail.adminPassword.trim().length > 0,
        mailSitePassword: config.mail.sitePassword.trim().length > 0,
        heroSmsApiKey: config.sms.heroSms.apiKey.trim().length > 0,
        fiveSimApiKey: config.sms.fiveSim.apiKey.trim().length > 0,
        syncPassword: config.sync.password.trim().length > 0,
      },
      configPath: CONFIG_PATH,
    };
  }

  private sendConfigSecret(url: URL, response: ServerResponse): void {
    const key = url.searchParams.get('key') as SecretKey | null;
    if (!key) {
      this.sendJson(response, 400, { error: '缺少 key' });
      return;
    }

    const value = this.getSecretValue(key);
    if (value === null) {
      this.sendJson(response, 404, { error: '未知敏感字段' });
      return;
    }

    this.sendJson(response, 200, { key, value });
  }

  private getSecretValue(key: SecretKey): string | null {
    const config = loadConfig();
    const values: Record<SecretKey, string> = {
      browserProxyPassword: config.browser.proxy.password,
      mailAdminPassword: config.mail.adminPassword,
      mailSitePassword: config.mail.sitePassword,
      heroSmsApiKey: config.sms.heroSms.apiKey,
      fiveSimApiKey: config.sms.fiveSim.apiKey,
      syncPassword: config.sync.password,
    };

    return key in values ? values[key] : null;
  }

  private maskSecret(value: string): string {
    return value.trim().length > 0 ? '******' : '';
  }

  private mergeSecrets(current: AppConfig, input: Partial<AppConfig>): AppConfig {
    return {
      ...current,
      ...input,
      browser: {
        ...current.browser,
        ...input.browser,
        viewport: {
          ...current.browser.viewport,
          ...input.browser?.viewport,
        },
        proxy: {
          ...current.browser.proxy,
          ...input.browser?.proxy,
          password: this.secretOrCurrent(input.browser?.proxy?.password, current.browser.proxy.password),
        },
      },
      mail: {
        ...current.mail,
        ...input.mail,
        adminPassword: this.secretOrCurrent(input.mail?.adminPassword, current.mail.adminPassword),
        sitePassword: this.secretOrCurrent(input.mail?.sitePassword, current.mail.sitePassword),
      },
      sms: {
        ...current.sms,
        ...input.sms,
        heroSms: {
          ...current.sms.heroSms,
          ...input.sms?.heroSms,
          apiKey: this.secretOrCurrent(input.sms?.heroSms?.apiKey, current.sms.heroSms.apiKey),
        },
        fiveSim: {
          ...current.sms.fiveSim,
          ...input.sms?.fiveSim,
          apiKey: this.secretOrCurrent(input.sms?.fiveSim?.apiKey, current.sms.fiveSim.apiKey),
        },
      },
      sync: {
        ...current.sync,
        ...input.sync,
        password: this.secretOrCurrent(input.sync?.password, current.sync.password),
      },
      oauth: {
        ...current.oauth,
        ...input.oauth,
      },
    };
  }

  private secretOrCurrent(value: unknown, current: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value === '******') {
      return current;
    }
    return value;
  }

  private getPublicActiveJob(): ActiveJob {
    return this.activeJob ? this.toPublicJob(this.activeJob) : null;
  }

  private toPublicJob(job: RunningJob): Exclude<ActiveJob, null> {
    return {
      type: job.type,
      startedAt: job.startedAt,
    };
  }

  private startChildJob(type: Exclude<ActiveJob, null>['type'], args: string[]): RunningJob {
    const child = spawn('npx', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const job: RunningJob = {
      type,
      startedAt: new Date().toISOString(),
      process: child,
    };
    this.activeJob = job;

    child.stdout?.on('data', (chunk) => this.logChildOutput(chunk));
    child.stderr?.on('data', (chunk) => this.logChildOutput(chunk));
    child.on('error', (error) => {
      logger.error(`[Web] ${type} 子进程启动失败：${error.message}`);
      if (this.activeJob?.process === child) {
        this.activeJob = null;
      }
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        logger.warn(`[Web] ${type} 任务已停止。signal=${signal}`);
      } else if (code === 0) {
        logger.info(`[Web] ${type} 任务执行完成。`);
      } else {
        logger.error(`[Web] ${type} 任务执行失败。exitCode=${code}`);
      }

      if (this.activeJob?.process === child) {
        this.activeJob = null;
      }
    });

    return job;
  }

  private logChildOutput(chunk: Buffer): void {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        logger.info(trimmed.replace(/\[[0-9;]*m/g, ''));
      }
    }
  }

  private stopActiveJob(response: ServerResponse): void {
    if (!this.activeJob) {
      this.sendJson(response, 404, { error: '当前没有正在运行的任务' });
      return;
    }

    const job = this.activeJob;
    job.process.kill('SIGTERM');
    logger.warn(`[Web] 已请求停止 ${job.type} 任务。pid=${job.process.pid}`);
    this.sendJson(response, 202, { accepted: true, job: this.toPublicJob(job) });
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        throw new Error('request body too large');
      }
      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private sendHtml(response: ServerResponse, html: string): void {
    this.setSecurityHeaders(response);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  }

  private sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
    if (response.headersSent) {
      return;
    }
    this.setSecurityHeaders(response);
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }

  private setSecurityHeaders(response: ServerResponse): void {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  }

  private renderPage(): string {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sweet Auto Register 管理页</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 16px; }
    a { color: #93c5fd; }
    section { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { background: #1e293b; border-radius: 10px; padding: 12px; }
    .label { color: #94a3b8; font-size: 12px; }
    .value { margin-top: 6px; font-size: 20px; font-weight: 700; }
    button, input { border-radius: 8px; border: 1px solid #475569; padding: 9px 12px; background: #1e293b; color: #e2e8f0; }
    button { cursor: pointer; background: #2563eb; border-color: #2563eb; font-weight: 700; }
    button.secondary { background: #334155; border-color: #475569; }
    button.danger { background: #7f1d1d; border-color: #991b1b; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #message { min-height: 24px; color: #fbbf24; }
    #logs { height: 420px; overflow: auto; background: #020617; border-radius: 10px; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; white-space: pre-wrap; }
    .log-INFO { color: #22c55e; }
    .log-WARN { color: #fb923c; }
    .log-ERROR { color: #ef4444; }
  </style>
</head>
<body>
  <main>
    <h1>Sweet Auto Register 本地管理页</h1>
    <p><a href="/config">进入配置管理</a></p>
    <p id="message"></p>

    <section>
      <h2>服务状态</h2>
      <div class="grid" id="status"></div>
      <p><button class="secondary" id="refreshStatus">刷新状态</button></p>
    </section>

    <section>
      <h2>任务操作</h2>
      <form id="automationForm">
        <label>账号数量 <input id="accountCount" type="number" min="1" max="20" value="1"></label>
        <button type="submit">启动自动化</button>
        <button type="button" id="syncButton" class="secondary">同步 CPA 文件</button>
        <button type="button" id="stopButton" class="danger" disabled>停止当前任务</button>
      </form>
    </section>

    <section>
      <h2>实时日志</h2>
      <div id="logs"></div>
    </section>
  </main>

  <script>
    let lastLogId = 0;

    function setMessage(message) {
      document.getElementById('message').textContent = message || '';
    }

    function card(label, value) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '请求失败');
      }
      return data;
    }

    async function refreshStatus() {
      try {
        const data = await fetchJson('/api/status');
        const activeJob = data.activeJob ? data.activeJob.type + ' / ' + data.activeJob.startedAt : '无';
        document.getElementById('stopButton').disabled = !data.activeJob;
        document.getElementById('status').innerHTML = [
          card('当前任务', activeJob),
          card('注册账号数', data.artifacts.registerCount),
          card('CPA 文件数', data.artifacts.cpaCount),
          card('当前手机号', data.artifacts.hasCurrentPhone ? '存在' : '无'),
          card('错误截图数', data.artifacts.screenshotCount),
          card('SMS Provider', data.config.smsProvider),
          card('同步启用', data.config.syncEnabled ? '是' : '否'),
          card('同步配置', data.config.syncHostConfigured && data.config.syncRemotePathConfigured ? '已填写' : '未完整'),
          card('OAuth Client', data.config.oauthClientIdConfigured ? '已填写' : '未填写')
        ].join('');
      } catch (error) {
        setMessage(error.message);
      }
    }

    async function pollLogs() {
      try {
        const data = await fetchJson('/api/logs?after=' + lastLogId);
        const logs = document.getElementById('logs');
        for (const entry of data.entries) {
          const line = document.createElement('div');
          line.className = 'log-' + entry.level;
          line.textContent = entry.line;
          logs.appendChild(line);
        }
        if (data.entries.length > 0) {
          lastLogId = data.lastId;
          logs.scrollTop = logs.scrollHeight;
        }
      } catch (error) {
        setMessage(error.message);
      }
    }

    document.getElementById('automationForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage('正在启动自动化任务...');
      try {
        const accountCount = Number(document.getElementById('accountCount').value);
        await fetchJson('/api/automation/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountCount })
        });
        setMessage('自动化任务已启动。');
        await refreshStatus();
      } catch (error) {
        setMessage(error.message);
      }
    });

    document.getElementById('syncButton').addEventListener('click', async () => {
      setMessage('正在启动 CPA 同步...');
      try {
        await fetchJson('/api/sync/start', { method: 'POST' });
        setMessage('CPA 同步任务已启动。');
        await refreshStatus();
      } catch (error) {
        setMessage(error.message);
      }
    });

    document.getElementById('stopButton').addEventListener('click', async () => {
      setMessage('正在停止当前任务...');
      try {
        await fetchJson('/api/task/stop', { method: 'POST' });
        setMessage('已发送停止请求。');
        await refreshStatus();
      } catch (error) {
        setMessage(error.message);
      }
    });

    document.getElementById('refreshStatus').addEventListener('click', refreshStatus);
    refreshStatus();
    pollLogs();
    setInterval(refreshStatus, 3000);
    setInterval(pollLogs, 1500);
  </script>
</body>
</html>`;
  }

  private renderConfigPage(): string {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sweet Auto Register 配置管理</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    a { color: #93c5fd; }
    section { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    fieldset { border: 1px solid #334155; border-radius: 10px; margin: 0 0 14px; padding: 14px; }
    legend { color: #cbd5e1; font-weight: 700; }
    label { display: grid; gap: 6px; color: #cbd5e1; font-size: 14px; }
    input, select { border-radius: 8px; border: 1px solid #475569; padding: 9px 12px; background: #1e293b; color: #e2e8f0; min-width: 0; }
    input[type="checkbox"] { width: 18px; min-width: 18px; }
    button { cursor: pointer; border-radius: 8px; border: 1px solid #2563eb; padding: 9px 12px; background: #2563eb; color: #e2e8f0; font-weight: 700; }
    button.secondary { background: #334155; border-color: #475569; }
    button.danger { background: #7f1d1d; border-color: #991b1b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .check { display: flex; align-items: center; gap: 8px; }
    .hint { color: #94a3b8; font-size: 12px; }
    #message { white-space: pre-wrap; min-height: 24px; color: #fbbf24; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #334155; padding: 8px; text-align: left; }
    th { color: #94a3b8; font-size: 12px; }
    td input { width: 100%; box-sizing: border-box; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .secret-field { display: flex; gap: 6px; }
    .secret-field input { flex: 1; }
    .secret-field button { white-space: nowrap; }
  </style>
</head>
<body>
  <main>
    <h1>配置管理</h1>
    <p><a href="/">返回管理页</a></p>
    <p id="message">正在加载配置...</p>

    <form id="configForm">
      <section>
        <h2>基础</h2>
        <div class="grid">
          <label>startUrl <input data-path="startUrl"></label>
        </div>
      </section>

      <section>
        <h2>浏览器</h2>
        <div class="grid">
          <label>provider <select data-path="browser.provider"><option>real-browser</option><option>puppeteer</option><option>puppeteer-extra</option></select></label>
          <label>challengeTimeoutMs <input data-path="browser.challengeTimeoutMs" type="number"></label>
          <label>chromePath <input data-path="browser.chromePath"></label>
          <label>viewport.width <input data-path="browser.viewport.width" type="number"></label>
          <label>viewport.height <input data-path="browser.viewport.height" type="number"></label>
          <label>proxy.host <input data-path="browser.proxy.host"></label>
          <label>proxy.port <input data-path="browser.proxy.port" type="number"></label>
          <label>proxy.username <input data-path="browser.proxy.username"></label>
          <label>proxy.password <span class="secret-field"><input data-path="browser.proxy.password" data-secret-key="browserProxyPassword" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="browserProxyPassword">查看</button></span><span class="hint" id="browserProxyPasswordHint"></span></label>
          <label class="check"><input data-path="browser.turnstile" type="checkbox"> turnstile</label>
          <label class="check"><input data-path="browser.useChrome" type="checkbox"> useChrome</label>
          <label class="check"><input data-path="browser.headless" type="checkbox"> headless</label>
          <label class="check"><input data-path="browser.keepOpen" type="checkbox"> keepOpen</label>
        </div>
      </section>

      <section>
        <h2>邮箱</h2>
        <div class="grid">
          <label>baseUrl <input data-path="mail.baseUrl"></label>
          <label>adminPassword <span class="secret-field"><input data-path="mail.adminPassword" data-secret-key="mailAdminPassword" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="mailAdminPassword">查看</button></span><span class="hint" id="mailAdminPasswordHint"></span></label>
          <label>sitePassword <span class="secret-field"><input data-path="mail.sitePassword" data-secret-key="mailSitePassword" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="mailSitePassword">查看</button></span><span class="hint" id="mailSitePasswordHint"></span></label>
          <label>domain <input data-path="mail.domain"></label>
          <label>pollIntervalMs <input data-path="mail.pollIntervalMs" type="number"></label>
          <label>maxAttempts <input data-path="mail.maxAttempts" type="number"></label>
        </div>
      </section>

      <section>
        <h2>短信</h2>
        <div class="grid">
          <label>provider <select data-path="sms.provider"><option>hero-sms</option><option>5sim</option></select></label>
          <label>pollIntervalMs <input data-path="sms.pollIntervalMs" type="number"></label>
          <label>maxAttempts <input data-path="sms.maxAttempts" type="number"></label>
          <label>numberMaxRetries <input data-path="sms.numberMaxRetries" type="number"></label>
        </div>

        <fieldset>
          <legend>Hero SMS</legend>
          <div class="grid">
            <label>apiKey <span class="secret-field"><input data-path="sms.heroSms.apiKey" data-secret-key="heroSmsApiKey" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="heroSmsApiKey">查看</button></span><span class="hint" id="heroSmsApiKeyHint"></span></label>
            <label>service <input data-path="sms.heroSms.service"></label>
          </div>
          <table id="heroCountries"><thead><tr><th>name</th><th>optionKey</th><th>dialCode</th><th>order</th><th>providerCountry</th><th>maxPrice</th><th></th></tr></thead><tbody></tbody></table>
          <p><button type="button" class="secondary" id="addHeroCountry">新增 Hero 国家</button></p>
        </fieldset>

        <fieldset>
          <legend>5sim</legend>
          <div class="grid">
            <label>apiKey <span class="secret-field"><input data-path="sms.fiveSim.apiKey" data-secret-key="fiveSimApiKey" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="fiveSimApiKey">查看</button></span><span class="hint" id="fiveSimApiKeyHint"></span></label>
            <label>product <input data-path="sms.fiveSim.product"></label>
          </div>
          <table id="fiveSimCountries"><thead><tr><th>name</th><th>optionKey</th><th>dialCode</th><th>order</th><th>providerCountry</th><th>operator</th><th>maxPrice</th><th></th></tr></thead><tbody></tbody></table>
          <p><button type="button" class="secondary" id="addFiveSimCountry">新增 5sim 国家</button></p>
        </fieldset>
      </section>

      <section>
        <h2>同步</h2>
        <div class="grid">
          <label class="check"><input data-path="sync.enabled" type="checkbox"> enabled</label>
          <label>host <input data-path="sync.host"></label>
          <label>port <input data-path="sync.port" type="number"></label>
          <label>username <input data-path="sync.username"></label>
          <label>password <span class="secret-field"><input data-path="sync.password" data-secret-key="syncPassword" type="password" autocomplete="new-password"><button type="button" class="secondary reveal-secret" data-secret-key="syncPassword">查看</button></span><span class="hint" id="syncPasswordHint"></span></label>
          <label>remotePath <input data-path="sync.remotePath"></label>
        </div>
      </section>

      <section>
        <h2>OAuth</h2>
        <div class="grid">
          <label>clientId <input data-path="oauth.clientId"></label>
          <label>authorizeUrl <input data-path="oauth.authorizeUrl"></label>
          <label>tokenUrl <input data-path="oauth.tokenUrl"></label>
          <label>redirectHost <input data-path="oauth.redirectHost"></label>
          <label>redirectPort <input data-path="oauth.redirectPort" type="number"></label>
          <label>redirectPath <input data-path="oauth.redirectPath"></label>
          <label>scope <input data-path="oauth.scope"></label>
        </div>
      </section>

      <section class="actions">
        <button type="submit">保存配置</button>
        <button type="button" class="secondary" id="reloadConfig">重新加载</button>
      </section>
    </form>
  </main>

  <script>
    let config = null;

    function setMessage(message) {
      document.getElementById('message').textContent = message || '';
    }

    function getValue(path) {
      return path.split('.').reduce((value, key) => value ? value[key] : undefined, config);
    }

    function setValue(target, path, value) {
      const keys = path.split('.');
      let current = target;
      for (let index = 0; index < keys.length - 1; index += 1) {
        current[keys[index]] ??= {};
        current = current[keys[index]];
      }
      current[keys[keys.length - 1]] = value;
    }

    function readField(input) {
      if (input.type === 'checkbox') {
        return input.checked;
      }
      if (input.type === 'number') {
        return Number(input.value);
      }
      return input.value;
    }

    function fillFields() {
      document.querySelectorAll('[data-path]').forEach((input) => {
        const value = getValue(input.dataset.path);
        if (input.type === 'checkbox') {
          input.checked = Boolean(value);
        } else {
          input.value = value ?? '';
        }
      });
    }

    function secretHint(id, hasValue) {
      document.getElementById(id).textContent = hasValue ? '已设置，保存 ****** 或留空都会保留旧值' : '未设置';
    }

    async function revealSecret(key) {
      const input = document.querySelector('[data-secret-key="' + key + '"][data-path]');
      const button = document.querySelector('button[data-secret-key="' + key + '"]');
      if (!input || !button) {
        return;
      }

      if (input.type === 'text') {
        input.type = 'password';
        button.textContent = '查看';
        return;
      }

      const data = await fetchJson('/api/config/secret?key=' + encodeURIComponent(key));
      input.value = data.value;
      input.type = 'text';
      button.textContent = '隐藏';
    }

    function makeCell(row, key, type) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.dataset.key = key;
      input.type = type || 'text';
      input.value = row[key] ?? '';
      cell.appendChild(input);
      return cell;
    }

    function renderHeroCountries(rows) {
      const tbody = document.querySelector('#heroCountries tbody');
      tbody.textContent = '';
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.append(makeCell(row, 'name'), makeCell(row, 'browserOptionKey'), makeCell(row, 'browserDialCode'), makeCell(row, 'order', 'number'), makeCell(row, 'providerCountry', 'number'), makeCell(row, 'maxPrice', 'number'));
        tr.append(actionCell(tr));
        tbody.appendChild(tr);
      }
    }

    function renderFiveSimCountries(rows) {
      const tbody = document.querySelector('#fiveSimCountries tbody');
      tbody.textContent = '';
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.append(makeCell(row, 'name'), makeCell(row, 'browserOptionKey'), makeCell(row, 'browserDialCode'), makeCell(row, 'order', 'number'), makeCell(row, 'providerCountry'), makeCell(row, 'providerOperator'), makeCell(row, 'maxPrice', 'number'));
        tr.append(actionCell(tr));
        tbody.appendChild(tr);
      }
    }

    function actionCell(tr) {
      const cell = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'danger';
      button.textContent = '删除';
      button.addEventListener('click', () => tr.remove());
      cell.appendChild(button);
      return cell;
    }

    function readTable(selector, numericKeys) {
      return Array.from(document.querySelectorAll(selector + ' tbody tr')).map((tr) => {
        const row = {};
        tr.querySelectorAll('input[data-key]').forEach((input) => {
          row[input.dataset.key] = numericKeys.includes(input.dataset.key) ? Number(input.value) : input.value;
        });
        return row;
      });
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) {
        if (Array.isArray(data.errors)) {
          throw new Error(data.errors.join('\\n'));
        }
        throw new Error(data.error || '请求失败');
      }
      return data;
    }

    async function loadConfig() {
      const data = await fetchJson('/api/config');
      config = data.config;
      fillFields();
      renderHeroCountries(config.sms.heroSms.countries);
      renderFiveSimCountries(config.sms.fiveSim.countries);
      secretHint('browserProxyPasswordHint', data.secrets.browserProxyPassword);
      secretHint('mailAdminPasswordHint', data.secrets.mailAdminPassword);
      secretHint('mailSitePasswordHint', data.secrets.mailSitePassword);
      secretHint('heroSmsApiKeyHint', data.secrets.heroSmsApiKey);
      secretHint('fiveSimApiKeyHint', data.secrets.fiveSimApiKey);
      secretHint('syncPasswordHint', data.secrets.syncPassword);
      setMessage('配置文件：' + data.configPath);
    }

    document.getElementById('configForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = {};
      document.querySelectorAll('[data-path]').forEach((input) => setValue(next, input.dataset.path, readField(input)));
      next.sms.heroSms.countries = readTable('#heroCountries', ['order', 'providerCountry', 'maxPrice']);
      next.sms.fiveSim.countries = readTable('#fiveSimCountries', ['order', 'maxPrice']);

      try {
        await fetchJson('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next)
        });
        setMessage('配置已保存。');
        await loadConfig();
      } catch (error) {
        setMessage(error.message);
      }
    });

    document.getElementById('reloadConfig').addEventListener('click', loadConfig);
    document.querySelectorAll('.reveal-secret').forEach((button) => button.addEventListener('click', () => revealSecret(button.dataset.secretKey).catch((error) => setMessage(error.message))));
    document.getElementById('addHeroCountry').addEventListener('click', () => renderHeroCountries([...readTable('#heroCountries', ['order', 'providerCountry', 'maxPrice']), { name: '', browserOptionKey: '', browserDialCode: '', order: 0, providerCountry: 0, maxPrice: 0 }]));
    document.getElementById('addFiveSimCountry').addEventListener('click', () => renderFiveSimCountries([...readTable('#fiveSimCountries', ['order', 'maxPrice']), { name: '', browserOptionKey: '', browserDialCode: '', order: 0, providerCountry: 'any', providerOperator: 'any', maxPrice: 0 }]));

    loadConfig().catch((error) => setMessage(error.message));
  </script>
</body>
</html>`;
  }
}
