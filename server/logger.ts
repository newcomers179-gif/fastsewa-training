import pino from "pino";
import { config } from "./config";

/**
 * Structured JSON logs (one object per line) in every environment except an
 * interactive development terminal, where they are pretty-printed. Secrets
 * are redacted at the logger level, so even an accidental `log.info({ body })`
 * cannot write a password or token to disk.
 */
function prettyStream() {
  if (!config.isDev || !process.stdout.isTTY) return undefined;
  try {
    // pino-pretty is a devDependency: absent in the production image, never loaded there.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pretty = require("pino-pretty") as (o: object) => NodeJS.WritableStream;
    return pretty({ colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service,env" });
  } catch {
    return undefined;
  }
}

const REDACT_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "temporaryPassword",
  "refreshToken",
  "accessToken",
  "token",
  "authorization",
  "cookie",
];

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: "fastsewa-api", env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    serializers: { err: pino.stdSerializers.err },
    redact: {
      paths: [
        ...REDACT_KEYS,
        ...REDACT_KEYS.map((k) => `*.${k}`),
        ...REDACT_KEYS.map((k) => `*.*.${k}`),
        'req.headers["x-registration-code"]',
      ],
      censor: "[redacted]",
    },
  },
  prettyStream()
);

export type Logger = typeof logger;
