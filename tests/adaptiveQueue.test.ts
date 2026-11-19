import { test, assert } from './harness';
import { AdaptiveTaskQueue } from '../src/util/adaptiveQueue';

function makeQueue(stepMs: number, order: number[]) {
    let clock = 0;
    const queue = new AdaptiveTaskQueue<number>({
        targetMs: 8,
        minBatch: 1,
        maxBatch: 16,
        now: () => clock,
        schedule: () => 0,
        cancel: () => {},
    });
    for (let i = 0; i < 200; i++) {
        queue.enqueue(i, () => {
            clock += stepMs;
            order.push(i);
        });
    }
    return { queue, getClock: () => clock };
}

test('adaptive queue grows its batch on a fast device', () => {
    const order: number[] = [];
    const { queue } = makeQueue(1, order);
    for (let i = 0; i < 10; i++) queue.runSlice();
    const stats = queue.stats;
    assert.ok(stats.batchSize > 1, String(stats.batchSize));
    assert.ok(stats.processed > 1, String(stats.processed));
});

test('adaptive queue collapses to one task on a slow device', () => {
    const order: number[] = [];
    const { queue } = makeQueue(20, order);
    for (let i = 0; i < 5; i++) queue.runSlice();
    assert.equal(queue.stats.batchSize, 1);
    assert.equal(queue.stats.processed, 5);
});

test('adaptive queue prioritizes requested keys without duplicates', () => {
    const order: number[] = [];
    const { queue } = makeQueue(1, order);
    queue.prioritize([5, 6]);
    queue.enqueue(5, () => order.push(5));
    queue.runSlice();
    assert.equal(order[0], 5);
    assert.equal(new Set(order).size, order.length);
});

test('adaptive queue stops after clear', () => {
    const order: number[] = [];
    const { queue } = makeQueue(1, order);
    queue.clear();
    assert.equal(queue.hasWork(), false);
    assert.equal(queue.stats.remaining, 0);
});
