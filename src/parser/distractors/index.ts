/** Parse `rv-distract` links under `## DISTRACTORS`. */
import type { DistractorLink, VarDef, Warning } from '../types';

function isConditionable(valueType: VarDef['valueType']): boolean {
    return valueType === 'number' || valueType === 'string' || valueType === 'quantity';
}

export function parseDistractorLinks(
    fence: string | undefined,
    vars: VarDef[],
    warnings: Warning[],
): DistractorLink[] {
    if (fence === undefined) return [];
    const byName = new Map(vars.map((def) => [def.name, def]));
    const byAnchor = new Map<string, string[]>();
    const linked = new Map<string, string>();

    for (const rawLine of fence.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === '') continue;

        const m = /^(.+?)\s*<-\s*([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(line);
        if (!m) {
            throw new Error(
                `rv-distract: cannot read "${line}" — use "target, target <- anchor"`,
            );
        }
        const anchorName = m[2] ?? '';
        const anchor = byName.get(anchorName);
        if (!anchor) {
            throw new Error(`rv-distract: anchor "${anchorName}" is not defined in rv-def`);
        }
        if (!isConditionable(anchor.valueType)) {
            throw new Error(
                `rv-distract: anchor "${anchorName}" is a ${anchor.valueType} value; ` +
                    'anchors must be numeric, expression, string, or quantity',
            );
        }

        const targets = (m[1] ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '');
        if (targets.length === 0) {
            throw new Error('rv-distract: missing target before "<-"');
        }

        for (const targetName of targets) {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(targetName)) {
                throw new Error(`rv-distract: "${targetName}" is not a valid variable name`);
            }
            const target = byName.get(targetName);
            if (!target) {
                throw new Error(`rv-distract: target "${targetName}" is not defined in rv-def`);
            }
            if (!isConditionable(target.valueType)) {
                warnings.push({
                    section: 'distractors',
                    message:
                        `rv-distract: target "${targetName}" is a ${target.valueType} value ` +
                        'and cannot be conditioned',
                });
                continue;
            }
            if (targetName === anchorName) {
                warnings.push({
                    section: 'distractors',
                    message: `rv-distract: "${targetName}" cannot use itself as an anchor`,
                });
                continue;
            }
            if (
                target.valueType === 'string' &&
                (anchor.valueType === 'number' || anchor.valueType === 'quantity')
            ) {
                warnings.push({
                    section: 'distractors',
                    message:
                        `rv-distract: string target "${targetName}" cannot be conditioned ` +
                        `by ${anchor.valueType} anchor "${anchorName}"`,
                });
                continue;
            }

            const previous = linked.get(targetName);
            if (previous !== undefined && previous !== anchorName) {
                warnings.push({
                    section: 'distractors',
                    message:
                        `rv-distract: "${targetName}" was already linked to "${previous}" — ` +
                        `the last anchor "${anchorName}" wins`,
                });
                const previousTargets = byAnchor.get(previous);
                if (previousTargets) {
                    const remaining = previousTargets.filter((name) => name !== targetName);
                    if (remaining.length === 0) byAnchor.delete(previous);
                    else byAnchor.set(previous, remaining);
                }
            }
            linked.set(targetName, anchorName);
            const list = byAnchor.get(anchorName) ?? [];
            if (!list.includes(targetName)) list.push(targetName);
            byAnchor.set(anchorName, list);
        }
    }

    return [...byAnchor.entries()].map(([anchor, targets]) => ({ anchor, targets }));
}
