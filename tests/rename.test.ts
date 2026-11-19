import { test, assert } from './harness';
import { resolvePresetRename, type PresetItem } from '../src/ui/presets/PresetManager';

const items: PresetItem[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
];

test('rename trims and updates only the target item', () => {
    const result = resolvePresetRename(items, 'a', '  Gamma ');
    assert.ok(result.ok);
    assert.equal(result.name, 'Gamma');
    assert.deepEqual(result.next.map((item) => item.name), ['Gamma', 'Beta']);
    assert.equal(result.next[1], items[1], 'other items keep their identity');
});

test('rename rejects an empty name', () => {
    const result = resolvePresetRename(items, 'a', '   ');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'empty');
});

test('rename rejects a case-insensitive duplicate', () => {
    const result = resolvePresetRename(items, 'a', 'beta');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'duplicate');
});

test('renaming an item to its own name is allowed', () => {
    const result = resolvePresetRename(items, 'a', 'ALPHA');
    assert.ok(result.ok);
    assert.equal(result.name, 'ALPHA');
});
