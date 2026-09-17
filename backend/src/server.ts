import type { Server } from "node:http";

import { createApp } from "./app";
import { appConfig } from "./config";
import { logEvent, type LogFields } from "./logger";

const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000;
const SYSTEM_CORRELATION_ID = "system";

/** Build non-sensitive structured logging fields for lifecycle events. */
function systemLogFields(
  extraFields: Record<string, boolean | number | string> = {},
): LogFields {
  return {
    ...extraFields,
    correlationId: SYSTEM_CORRELATION_ID,
    requestId: SYSTEM_CORRELATION_ID,
  };
}

/** Force termination only after the graceful shutdown timeout has elapsed. */
function forceShutdown(): void {
  logEvent("ERROR", "server_shutdown_timeout", systemLogFields());
  process.exit(1);
}

/** Stop accepting connections and finish active requests after a process signal. */
function gracefullyShutdown(server: Server, signal: NodeJS.Signals): void {
  logEvent("INFO", "server_shutdown_started", systemLogFields({ signal }));
  const timeout = setTimeout(forceShutdown, SHUTDOWN_TIMEOUT_MILLISECONDS);
  timeout.unref();

  server.close((error?: Error): void => {
    clearTimeout(timeout);
    if (error !== undefined) {
      logEvent("ERROR", "server_shutdown_failed", systemLogFields());
      process.exitCode = 1;
      return;
    }

    logEvent("INFO", "server_shutdown_completed", systemLogFields());
  });
}

/** Register one-time process handlers that invoke the graceful shutdown path. */
function registerShutdownHandlers(server: Server): void {
  let isShuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    gracefullyShutdown(server, signal);
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

/** Start the HTTP server using validated environment configuration. */
export function startServer(): Server {
  const server = createApp().listen(appConfig.port, appConfig.host, () => {
    logEvent("INFO", "server_started", systemLogFields({ host: appConfig.host, port: appConfig.port }));
  });

  registerShutdownHandlers(server);
  return server;
}

if (require.main === module) {
  startServer();
}
