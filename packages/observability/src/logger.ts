import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { sanitizeForLog } from './sanitize';

export interface CreateLoggerOptions {
  level?: string;
  component?: string;
  pretty?: boolean;
  destination?: DestinationStream;
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.password',
  '*.authorization'
];

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: { component: options.component ?? 'app' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      err: pino.stdSerializers.err,
      context: (value: unknown) => sanitizeForLog(value)
    }
  };

  if (options.pretty === true && options.destination === undefined) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' }
      }
    });
  }

  return pino(config, options.destination);
}
