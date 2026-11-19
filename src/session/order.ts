/** Display-order modes for a fixed subset of questions. */
import type { OrderMode } from '../constants';
import type { Question } from '../parser';
import { shuffleSeeded } from './rng';

export function orderPool(subset: Question[], order: OrderMode, rng: () => number): Question[] {
    switch (order) {
        case 'source':
            return subset.slice();
        case 'random':
            return shuffleSeeded(subset, rng);
        case 'priority':
            return subset
                .slice()
                .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
        case 'priority-random': {
            const groups = new Map<number, Question[]>();
            for (const q of subset) {
                if (!groups.has(q.priority)) groups.set(q.priority, []);
                groups.get(q.priority)!.push(q);
            }
            const out: Question[] = [];
            const priorities = [...groups.keys()].sort((a, b) => a - b);
            for (const p of priorities) {
                out.push(...shuffleSeeded(groups.get(p)!, rng));
            }
            return out;
        }
    }
}