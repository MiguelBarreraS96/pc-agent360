import type { Server } from "node:http";

import type { Firestore } from "firebase-admin/firestore";

import { createApp } from "./app";
import { createApplicationDependencies } from "./composition";
import { appConfig } from "./config";
import { createFirestoreClient } from "./database/firestore";
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

/** Close the Firestore client after active HTTP requests have finished. */
async function closeFirestore(firestore: Firestore, hadServerError: boolean, timeout: NodeJS.Timeout): Promise<void> {
  try {
    await firestore.terminate();
    logEvent("INFO", "server_shutdown_completed", systemLogFields());
  } catch {
    logEvent("ERROR", "database_shutdown_failed", systemLogFields());
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    if (hadServerError) {
      process.exitCode = 1;
    }
  }
}

/** Stop accepting connections and close Firestore after a process signal. */
function gracefullyShutdown(server: Server, firestore: Firestore, signal: NodeJS.Signals): void {
  logEvent("INFO", "server_shutdown_started", systemLogFields({ signal }));
  const timeout = setTimeout(forceShutdown, SHUTDOWN_TIMEOUT_MILLISECONDS);
  timeout.unref();

  server.close((error?: Error): void => {
    if (error !== undefined) {
      logEvent("ERROR", "server_shutdown_failed", systemLogFields());
    }
    void closeFirestore(firestore, error !== undefined, timeout);
  });
}

/** Register one-time process handlers that invoke the graceful shutdown path. */
function registerShutdownHandlers(server: Server, firestore: Firestore): void {
  let isShuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    gracefullyShutdown(server, firestore, signal);
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

/** Start the HTTP server using validated configuration and injected infrastructure adapters. */
export function startServer(): Server {
  const firestore = createFirestoreClient(appConfig);
  const dependencies = createApplicationDependencies(appConfig, firestore);
  const server = createApp(dependencies).listen(appConfig.port, appConfig.host, () => {
    logEvent("INFO", "server_started", systemLogFields({ host: appConfig.host, port: appConfig.port }));
  });

  registerShutdownHandlers(server, firestore);
  return server;
}

if (require.main === module) {
  startServer();
}
