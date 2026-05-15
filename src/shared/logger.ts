import chalk from 'chalk';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  line: string;
};

const MAX_LOG_ENTRIES = 1000;

const colors: Record<LogLevel, (message: string) => string> = {
  INFO: chalk.green,
  WARN: chalk.hex('#ff8c00'),
  ERROR: chalk.red,
};

let nextLogId = 1;
const entries: LogEntry[] = [];

function sanitize(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
      const [name, domain] = email.split('@');
      return `${name.slice(0, 1)}***@${domain}`;
    })
    .replace(/\b(password|apiKey|access_token|refresh_token|id_token|jwt)(\s*[=:]\s*)([^\s,;&}]+)/gi, '$1$2***');
}

function createEntry(level: LogLevel, message: string): LogEntry {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  return {
    id: nextLogId,
    timestamp,
    level,
    message,
    line,
  };
}

function record(entry: LogEntry): void {
  nextLogId += 1;
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }
}

function format(entry: LogEntry): string {
  return colors[entry.level](entry.line);
}

export function getRecentLogs(afterId = 0): LogEntry[] {
  return entries
    .filter((entry) => entry.id > afterId)
    .map((entry) => {
      const message = sanitize(entry.message);
      return {
        ...entry,
        message,
        line: `[${entry.timestamp}] [${entry.level}] ${message}`,
      };
    });
}

export const logger = {
  info(message: string): void {
    const entry = createEntry('INFO', message);
    record(entry);
    console.log(format(entry));
  },
  warn(message: string): void {
    const entry = createEntry('WARN', message);
    record(entry);
    console.warn(format(entry));
  },
  error(message: string): void {
    const entry = createEntry('ERROR', message);
    record(entry);
    console.error(format(entry));
  },
};
