/** Clipboard helpers shared across layers. */

/**
 * Write text to the clipboard. Rejects when the async clipboard API is
 * unavailable or refuses the write; the caller reports the failure.
 */
export async function copyText(text: string): Promise<void> {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable');
    }
    await clipboard.writeText(text);
}
