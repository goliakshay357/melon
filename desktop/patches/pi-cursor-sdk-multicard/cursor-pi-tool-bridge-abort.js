class CursorPiToolBridgeToolExecutionAbortTracker {
    activeExecutions = new Map();
    processSignalHandlersInstalled = false;
    track(toolCallId, options) {
        this.finish(toolCallId);
        const execution = {
            toolCallId,
            abort: options.abort,
            cancelPending: options.cancelPending,
            signal: options.signal,
        };
        if (options.signal?.aborted) {
            this.cancelExecution(execution, "Cursor pi bridge tool execution was already aborted");
            this.abortExecution(execution);
            return false;
        }
        execution.onAbort = () => {
            this.cancelExecution(execution, "Cursor pi bridge tool execution was aborted");
            this.abortExecution(execution);
            this.finish(toolCallId);
        };
        execution.signal?.addEventListener("abort", execution.onAbort, { once: true });
        this.activeExecutions.set(toolCallId, execution);
        this.installProcessSignalHandlers();
        return true;
    }
    finish(toolCallId) {
        const execution = this.activeExecutions.get(toolCallId);
        if (!execution)
            return;
        if (execution.onAbort)
            execution.signal?.removeEventListener("abort", execution.onAbort);
        this.activeExecutions.delete(toolCallId);
        this.uninstallProcessSignalHandlersIfIdle();
    }
    finishAll() {
        for (const toolCallId of [...this.activeExecutions.keys()])
            this.finish(toolCallId);
    }
    abort(toolCallId, reason) {
        const execution = this.activeExecutions.get(toolCallId);
        if (!execution)
            return false;
        this.cancelExecution(execution, reason);
        this.abortExecution(execution);
        this.finish(toolCallId);
        return true;
    }
    abortAll(reason) {
        for (const execution of [...this.activeExecutions.values()]) {
            this.abort(execution.toolCallId, reason);
        }
    }
    /** Abort only executions whose toolCallId matches. Used so one session's shutdown does not kill siblings. */
    abortMatching(predicate, reason) {
        for (const execution of [...this.activeExecutions.values()]) {
            if (predicate(execution.toolCallId))
                this.abort(execution.toolCallId, reason);
        }
    }
    getActiveCount() {
        return this.activeExecutions.size;
    }
    emitProcessAbortSignalForTests(signal) {
        this.abortActiveExecutions(signal, { preserveProcessSignalBehavior: true });
    }
    handleSigint = () => {
        this.abortActiveExecutions("SIGINT");
    };
    handleSigterm = () => {
        this.abortActiveExecutions("SIGTERM");
    };
    installProcessSignalHandlers() {
        if (this.processSignalHandlersInstalled)
            return;
        this.processSignalHandlersInstalled = true;
        process.on("SIGINT", this.handleSigint);
        process.on("SIGTERM", this.handleSigterm);
    }
    uninstallProcessSignalHandlersIfIdle() {
        if (!this.processSignalHandlersInstalled || this.activeExecutions.size > 0)
            return;
        this.processSignalHandlersInstalled = false;
        process.off("SIGINT", this.handleSigint);
        process.off("SIGTERM", this.handleSigterm);
    }
    abortActiveExecutions(signal, options = {}) {
        if (this.activeExecutions.size === 0)
            return;
        const shouldRestoreDefaultSignalBehavior = options.preserveProcessSignalBehavior !== true && !this.hasExternalProcessSignalListeners(signal);
        this.abortAll(`Cursor pi bridge tool execution interrupted by ${signal}`);
        if (shouldRestoreDefaultSignalBehavior)
            this.restoreDefaultProcessSignalBehavior(signal);
    }
    cancelExecution(execution, reason) {
        try {
            execution.cancelPending(reason);
        }
        catch {
            // Cancellation is best-effort during process abort/shutdown cleanup; keep aborting siblings.
        }
    }
    abortExecution(execution) {
        try {
            Promise.resolve(execution.abort()).catch(() => undefined);
        }
        catch {
            // Abort is best-effort during process abort/shutdown cleanup; keep aborting siblings.
        }
    }
    hasExternalProcessSignalListeners(signal) {
        const ownHandler = signal === "SIGINT" ? this.handleSigint : this.handleSigterm;
        return process.listeners(signal).some((listener) => listener !== ownHandler);
    }
    restoreDefaultProcessSignalBehavior(signal) {
        setImmediate(() => {
            process.kill(process.pid, signal);
        });
    }
}
export const bridgeToolExecutionAbortTracker = new CursorPiToolBridgeToolExecutionAbortTracker();
