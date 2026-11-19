/** Tiny test registry and runner. Supports sync and async tests. */
import assert from 'node:assert/strict';

type TestFn = () => void | Promise<void>;

const tests: { name: string; fn: TestFn }[] = [];

export function test(name: string, fn: TestFn): void {
    tests.push({ name, fn });
}

export async function run(): Promise<void> {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ok  ${name}`);
        } catch (e) {
            failed++;
            console.error(`FAIL  ${name}`);
            console.error(`      ${(e as Error).message}`);
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    if (failed > 0) process.exitCode = 1;
}

export { assert };
