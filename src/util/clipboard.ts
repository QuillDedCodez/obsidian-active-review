/** Clipboard helpers shared across layers. */

/**
 * Write text to the clipboard, falling back to a hidden textarea when the
 * async clipboard API is unavailable or rejected. Throws when both fail.
 */
export async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall through to the synchronous fallback.
        }
    }

    const area = activeDocument.createEl('textarea', {
        cls: 'rv-clipboard-fallback',
    });
    area.value = text;
    area.setAttribute('readonly', 'true');
    activeDocument.body.appendChild(area);
    area.select();
    try {
        if (!activeDocument.execCommand('copy')) {
            throw new Error('execCommand("copy") returned false');
        }
    } finally {
        area.remove();
    }
}
