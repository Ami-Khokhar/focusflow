/**
 * Race a promise against a timeout.  Rejects with Error('TIMEOUT') on expiry.
 */
export function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms)),
    ]);
}
