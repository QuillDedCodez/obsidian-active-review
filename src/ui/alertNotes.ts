/**
 * Start-screen alert outlines: copy formatting and the copy-button wiring.
 *
 * The formatters are pure so they can be tested without a DOM. The button
 * itself is the shared `CopyButton`; this module only supplies the alert
 * defaults (link-style button, label feedback, no <details> toggling).
 */
import type { Warning } from '../parser';
import { createCopyButton, type CopyButton } from './CopyButton';

/** `# Skipped Note — 2 notes` plus one wiki-linked bullet per note. */
export function formatSkippedNotes(issues: readonly [string, string][]): string {
    const count = issues.length;
    const lines = [
        `# Skipped Note — ${count} note${count === 1 ? '' : 's'}`,
        '',
    ];
    for (const [path, reason] of issues) {
        lines.push(`- [[${path}]]`);
        lines.push(`  - General Error: ${reason}`);
    }
    return lines.join('\n');
}

/** `# Warning Note — 37 warnings in 34 notes`, grouped exactly as displayed. */
export function formatWarningNotes(
    warnings: readonly [string, Warning[]][],
): string {
    const total = warnings.reduce((n, [, ws]) => n + ws.length, 0);
    const notes = warnings.length;
    const lines = [
        `# Warning Note — ${total} warning${total === 1 ? '' : 's'} in ` +
            `${notes} note${notes === 1 ? '' : 's'}`,
        '',
    ];
    for (const [path, ws] of warnings) {
        lines.push(`- [[${path}]]`);
        for (const w of ws) {
            lines.push(`  - ## ${w.section.toUpperCase()}: ${w.message}`);
        }
    }
    return lines.join('\n');
}

export interface AlertCopyButtonOptions {
    getText: () => string;
    ariaLabel: string;
}

/**
 * Attach the alert-outline copy button. `stopPropagation` keeps the click from
 * collapsing the surrounding `<details>`.
 */
export function attachAlertCopyButton(
    parent: HTMLElement,
    options: AlertCopyButtonOptions,
): CopyButton {
    return createCopyButton(parent, {
        getText: options.getText,
        ariaLabel: options.ariaLabel,
        title: options.ariaLabel,
        label: '',
        // Same Lucide icons Obsidian uses for its code-block copy button.
        icon: 'copy',
        copiedIcon: 'check',
        className: 'rv-alert-copy',
        feedback: 'label',
        stopPropagation: true,
    });
}
