const SERVICE_NAME = "pc-agent360-backend";

export type LogLevel = "ERROR" | "INFO" | "WARN";
type LogValue = boolean | number | string;

export interface LogFields {
  readonly correlationId: string;
  readonly requestId: string;
  readonly [key: string]: LogValue;
}

interface LogEntry extends LogFields {
  readonly "service.name": string;
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
}

/** Write a structured, non-sensitive event to standard output. */
export function logEvent(level: LogLevel, message: string, fields: LogFields): void {
  const entry: LogEntry = {
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    message,
    "service.name": SERVICE_NAME,
  };

  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
