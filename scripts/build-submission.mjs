#!/usr/bin/env node
/**
 * Standalone production build for the published submission repository.
 *
 *   npm run build
 *
 * This is the general-purpose build: it verifies the sources (type-check, lint,
 * and tests), bundles `main.js`, and checks the release artifacts. It does not
 * copy files to another folder and does not manage documentation. Those steps
 * belong to the OpenCode development workspace, not to the published plugin.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function step(message) {
    console.log(`\n==> ${message}`);
}

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

function npmSpawn(args, options = {}) {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
        return spawnSync(process.execPath, [npmExecPath, ...args], {
            cwd: ROOT,
            stdio: options.stdio ?? 'inherit',
            encoding: options.encoding,
            env: { ...process.env, ...options.env },
            shell: false,
        });
    }
    if (process.platform === 'win32') {
        // Resolve npm.cmd/.ps1 shims reliably on Windows.
        return spawnSync('npm', args, {
            cwd: ROOT,
            stdio: options.stdio ?? 'inherit',
            encoding: options.encoding,
            env: { ...process.env, ...options.env },
            shell: true,
        });
    }
    return spawnSync('npm', args, {
        cwd: ROOT,
        stdio: options.stdio ?? 'inherit',
        encoding: options.encoding,
        env: { ...process.env, ...options.env },
        shell: false,
    });
}

function runNpm(args, options = {}) {
    const result = npmSpawn(args, options);
    if (result.error) fail(`could not run npm: ${result.error.message}`);
    if (result.status !== 0) {
        fail(`npm ${args.join(' ')} exited with code ${result.status}`);
    }
}

step('Checking toolchain');
if (Number(process.versions.node.split('.')[0]) < 18) {
    fail(`Node.js 18+ required, found ${process.version}`);
}
if (!fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
    fail('package-lock.json is required for reproducible installs');
}
const npmVersion = npmSpawn(['--version'], { encoding: 'utf8', stdio: 'pipe' });
if (npmVersion.error || npmVersion.status !== 0) fail('npm is not available on PATH');
console.log(`node ${process.version} / npm ${String(npmVersion.stdout).trim()} / ${process.platform}`);

step('Installing dependencies');
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    // Exact-lockfile install with integrity checks; install scripts stay blocked.
    runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
} else {
    console.log('node_modules present (run "npm ci" manually to reinstall from the lockfile)');
}

step('Auditing production dependencies');
runNpm(['audit', '--omit=dev', '--audit-level=high']);

step('Verifying sources');
runNpm(['run', 'verify']);

step('Bundling production build');
runNpm(['run', 'build:bundle'], { env: { NODE_ENV: 'production' } });

step('Checking bundle artifacts');
{
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const versions = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
    const bundle = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

    const problems = [];
    if (bundle.length === 0) problems.push('main.js is empty');
    if (bundle.includes('sourceMappingURL')) problems.push('main.js contains a source map reference');
    const rootVariants = [ROOT, ROOT.replaceAll('\\', '/'), ROOT.replaceAll('/', '\\')];
    if (rootVariants.some((variant) => bundle.includes(variant))) {
        problems.push("main.js embeds this machine's absolute path");
    }
    if (bundle.includes('\r\n')) problems.push('main.js has CRLF line endings');
    if (!fs.existsSync(path.join(ROOT, 'styles.css'))) problems.push('styles.css is missing');
    if (pkg.version !== manifest.version) {
        problems.push(`package.json version ${pkg.version} != manifest.json version ${manifest.version}`);
    }
    if (versions[manifest.version] !== manifest.minAppVersion) {
        problems.push(
            `versions.json entry for ${manifest.version} must equal minAppVersion ${manifest.minAppVersion}`,
        );
    }
    if (manifest.author === 'Your Name') {
        console.warn('warning: manifest.json author is still the placeholder "Your Name"');
    }
    if (problems.length) {
        console.error('artifact check failed:\n - ' + problems.join('\n - '));
        process.exit(1);
    }
    console.log(
        `main.js ${bundle.length} bytes, version ${manifest.version}, no source map, clean paths`,
    );
}

step('Build complete');
const hash = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'main.js'))).digest('hex');
console.log(`${hash}  main.js`);
