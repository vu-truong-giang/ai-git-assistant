export interface LinkedSignal {
    readonly signal: AbortSignal;
    /** True when the signal fired because the timeout elapsed (not a user cancel). */
    timedOut(): boolean;
    dispose(): void;
}

/**
 * Combines an optional caller signal with a timeout into one AbortSignal,
 * remembering which of the two fired so errors can be reported precisely.
 */
export function createLinkedSignal(
    timeoutMs: number | undefined,
    external?: AbortSignal
): LinkedSignal {
    const controller = new AbortController();
    let didTimeOut = false;

    const onExternalAbort = () => controller.abort(external?.reason);
    if (external?.aborted) {
        controller.abort(external.reason);
    } else {
        external?.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timer = timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            didTimeOut = true;
            controller.abort(new Error(`Timed out after ${timeoutMs} ms`));
        }, timeoutMs)
        : undefined;

    return {
        signal: controller.signal,
        timedOut: () => didTimeOut,
        dispose: () => {
            if (timer) {
                clearTimeout(timer);
            }
            external?.removeEventListener('abort', onExternalAbort);
        }
    };
}

/** setTimeout as a promise that rejects early if the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
