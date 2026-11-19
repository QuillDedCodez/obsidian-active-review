/** Session configuration preset export/import. Configuration only, no question content. */
import {
    DEFAULT_SESSION_CONFIG,
    clampChoiceCount,
    type SessionConfig,
} from '../constants';
import type { Mode } from '../session';
import type { ManageQuestionPreset } from './managePresets';
import type { SessionPreset } from './sessionPresets';

export const SESSION_PRESET_FORMAT = 'active-review/session-presets';
export const SESSION_PRESET_VERSION = 1;
export const SESSION_PRESET_MAX_BYTES = 1024 * 1024;
export const SESSION_PRESET_MAX_PRESETS = 200;

export const ALL_MANAGE_PRESET_NAME = 'All questions';
export const LAST_CUSTOM_MANAGE_PRESET_NAME = 'Last custom';

export type SessionPresetImportMode = 'add' | 'update';

export interface SessionPresetManifestPreset {
    name: string;
    mode: Mode;
    /** Manage Questions preset name only. Null = no resolvable name at export. */
    managePresetName: string | null;
    /** Whether this preset appears on the start screen. Defaults to true. */
    showOnStart?: boolean;
    /** Session configuration without the local managePresetId. */
    config: Omit<SessionConfig, 'managePresetId'>;
}

export interface SessionPresetManifest {
    format: string;
    version: number;
    exportedAt: string;
    presets: SessionPresetManifestPreset[];
}

export interface SessionPresetBuildResult {
    manifest: SessionPresetManifest;
    warnings: string[];
}

export interface SessionPresetParseResult {
    manifest: SessionPresetManifest | null;
    errors: string[];
    warnings: string[];
}

export interface SessionPresetImportRow {
    name: string;
    mode: Mode;
    managePresetName: string | null;
    managePresetId: string | null;
    status: 'ready' | 'manage-missing' | 'invalid';
    message: string;
    config: SessionConfig | null;
    showOnStart: boolean;
}

export interface SessionPresetImportPreview {
    rows: SessionPresetImportRow[];
    errors: string[];
    warnings: string[];
}

export interface SessionPresetApplyResult {
    added: number;
    updated: number;
    skipped: number;
    presets: SessionPreset[];
    errors: string[];
}

export interface SessionPresetExportOptions {
    presets: SessionPreset[];
    managePresets: ManageQuestionPreset[];
    hasLastCustom: boolean;
}

export interface SessionPresetImportOptions {
    managePresets: ManageQuestionPreset[];
    hasLastCustom: boolean;
}

export interface SessionPresetApplyOptions {
    existing: SessionPreset[];
    preview: SessionPresetImportPreview;
    mode: SessionPresetImportMode;
    generateId: () => string;
    save: (presets: SessionPreset[]) => Promise<void>;
}

function cloneConfig(config: SessionConfig): Omit<SessionConfig, 'managePresetId'> {
    const { managePresetId: _ignored, ...rest } = config;
    return { ...rest };
}

function manageNameFor(
    preset: SessionPreset,
    managePresets: ManageQuestionPreset[],
    hasLastCustom: boolean,
): { name: string | null; warning?: string } {
    if (preset.config.managePresetId === 'all') {
        return { name: ALL_MANAGE_PRESET_NAME };
    }
    if (preset.config.managePresetId === 'last-custom') {
        return hasLastCustom
            ? { name: LAST_CUSTOM_MANAGE_PRESET_NAME }
            : {
                  name: LAST_CUSTOM_MANAGE_PRESET_NAME,
                  warning: `"${preset.name}" references Last custom, but no last-custom selection exists.`,
              };
    }
    const manage = managePresets.find((p) => p.id === preset.config.managePresetId);
    if (!manage) {
        return {
            name: null,
            warning: `"${preset.name}" references a missing Manage Questions preset.`,
        };
    }
    return { name: manage.name };
}

export function buildSessionPresetManifest(
    options: SessionPresetExportOptions,
): SessionPresetBuildResult {
    const warnings: string[] = [];
    const presets: SessionPresetManifestPreset[] = options.presets.map((preset) => {
        const resolved = manageNameFor(preset, options.managePresets, options.hasLastCustom);
        if (resolved.warning) warnings.push(resolved.warning);
        return {
            name: preset.name,
            mode: preset.mode,
            managePresetName: resolved.name,
            showOnStart: preset.showOnStart ?? true,
            config: cloneConfig({ ...DEFAULT_SESSION_CONFIG, ...preset.config }),
        };
    });
    return {
        manifest: {
            format: SESSION_PRESET_FORMAT,
            version: SESSION_PRESET_VERSION,
            exportedAt: new Date().toISOString(),
            presets,
        },
        warnings,
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const n = Math.floor(numberOr(value, fallback));
    return Math.max(min, Math.min(max, n));
}

function normalizeConfig(raw: unknown, mode: Mode): SessionConfig | null {
    const source = asRecord(raw);
    if (!source) return null;
    const defaults = DEFAULT_SESSION_CONFIG;
    const config: SessionConfig = {
        ...defaults,
        presentation: source.presentation === 'one' ? 'one' : 'all',
        choiceCount: clampChoiceCount(source.choiceCount),
        count:
            source.count === 'all'
                ? 'all'
                : typeof source.count === 'number' && Number.isFinite(source.count)
                  ? clampInt(source.count, 1, 1, 1000000)
                  : defaults.count,
        trim: source.trim === 'rand' ? 'rand' : 'seq',
        order:
            source.order === 'random' ||
            source.order === 'priority' ||
            source.order === 'priority-random'
                ? source.order
                : 'source',
        seed: clampInt(source.seed, 0, 0, 2 ** 31 - 1),
        submitMode:
            source.submitMode === 'auto' || source.submitMode === 'all'
                ? source.submitMode
                : 'any',
        gradeMode: source.gradeMode === 'afterAll' ? 'afterAll' : 'immediate',
        passScore:
            source.passScore === 'off'
                ? 'off'
                : typeof source.passScore === 'number' &&
                    Number.isFinite(source.passScore)
                  ? clampInt(source.passScore, 70, 0, 100)
                  : defaults.passScore,
        managePresetId: 'all',
        timerSessionMode:
            source.timerSessionMode === 'on' || source.timerSessionMode === 'soft'
                ? source.timerSessionMode
                : 'off',
        timerSessionSeconds: clampInt(source.timerSessionSeconds, 60, 0, 86400),
        timerSessionWarningSeconds: clampInt(source.timerSessionWarningSeconds, 0, 0, 86400),
        timerQuestionMode:
            source.timerQuestionMode === 'on' || source.timerQuestionMode === 'soft'
                ? source.timerQuestionMode
                : 'off',
        timerQuestionSeconds: clampInt(source.timerQuestionSeconds, 60, 0, 86400),
        timerQuestionWarningSeconds: clampInt(source.timerQuestionWarningSeconds, 0, 0, 86400),
        stopwatchSession: source.stopwatchSession === true,
        stopwatchQuestion: source.stopwatchQuestion === true,
        navigator: source.navigator === false ? false : defaults.navigator,
        allowFlag: source.allowFlag === false ? false : defaults.allowFlag,
    };
    if (mode === 'typed' && config.submitMode === 'auto') config.submitMode = 'any';
    if (config.presentation !== 'one' || config.submitMode === 'all') {
        config.timerQuestionMode = 'off';
        config.stopwatchQuestion = false;
    }
    if (config.timerSessionMode !== 'off' && config.timerSessionSeconds <= 0) {
        config.timerSessionSeconds = 60;
    }
    if (config.timerQuestionMode !== 'off' && config.timerQuestionSeconds <= 0) {
        config.timerQuestionSeconds = 60;
    }
    return config;
}

export function parseSessionPresetManifest(text: string): SessionPresetParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!text.trim()) return { manifest: null, errors: ['Manifest is empty.'], warnings };
    if (new TextEncoder().encode(text).length > SESSION_PRESET_MAX_BYTES) {
        return { manifest: null, errors: ['Manifest is too large.'], warnings };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return {
            manifest: null,
            errors: [`Invalid JSON: ${(e as Error).message}`],
            warnings,
        };
    }
    const root = asRecord(raw);
    if (!root) return { manifest: null, errors: ['Manifest root must be an object.'], warnings };
    if (root.format !== SESSION_PRESET_FORMAT) {
        errors.push(`Unsupported format. Expected "${SESSION_PRESET_FORMAT}".`);
    }
    if (root.version !== SESSION_PRESET_VERSION) {
        errors.push(`Unsupported version. Expected ${SESSION_PRESET_VERSION}.`);
    }
    if (!Array.isArray(root.presets)) {
        errors.push('"presets" must be an array.');
    }
    if (errors.length > 0) return { manifest: null, errors, warnings };

    const rawPresets = root.presets as unknown[];
    if (rawPresets.length > SESSION_PRESET_MAX_PRESETS) {
        errors.push(`Too many presets (maximum ${SESSION_PRESET_MAX_PRESETS}).`);
    }
    const names = new Set<string>();
    const presets: SessionPresetManifestPreset[] = [];
    rawPresets.forEach((item, i) => {
        const label = `Preset ${i + 1}`;
        const preset = asRecord(item);
        if (!preset) {
            errors.push(`${label}: must be an object.`);
            return;
        }
        const name = typeof preset.name === 'string' ? preset.name.trim() : '';
        if (!name) errors.push(`${label}: name is required.`);
        if (name && names.has(name.toLowerCase())) {
            errors.push(`${label}: duplicate preset name "${name}".`);
        }
        if (name) names.add(name.toLowerCase());
        const mode: Mode = preset.mode === 'typed' ? 'typed' : 'choice';
        if (preset.mode !== 'choice' && preset.mode !== 'typed') {
            errors.push(`${label}: mode must be "choice" or "typed".`);
        }
        const managePresetName =
            preset.managePresetName === null
                ? null
                : typeof preset.managePresetName === 'string'
                  ? preset.managePresetName.trim()
                  : null;
        if (managePresetName === null) {
            warnings.push(`${label}: no Manage Questions preset name was exported.`);
        }
        const config = normalizeConfig(preset.config, mode);
        if (!config) {
            errors.push(`${label}: config must be an object.`);
            return;
        }
        const { managePresetId: _localManageId, ...configWithoutManage } = config;
        if (name) {
            presets.push({
                name,
                mode,
                managePresetName,
                config: configWithoutManage,
            });
        }
    });
    if (errors.length > 0) return { manifest: null, errors, warnings };
    return {
        manifest: {
            format: SESSION_PRESET_FORMAT,
            version: SESSION_PRESET_VERSION,
            exportedAt:
                typeof root.exportedAt === 'string' ? root.exportedAt : new Date().toISOString(),
            presets,
        },
        errors,
        warnings,
    };
}

function resolveManagePreset(
    name: string | null,
    options: SessionPresetImportOptions,
): { id: string | null; error?: string } {
    if (!name) return { id: null, error: 'No Manage Questions preset name was exported.' };
    if (name === ALL_MANAGE_PRESET_NAME) return { id: 'all' };
    if (name === LAST_CUSTOM_MANAGE_PRESET_NAME) {
        return options.hasLastCustom
            ? { id: 'last-custom' }
            : { id: null, error: 'Last custom is not available in this vault.' };
    }
    const match = options.managePresets.find(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    return match
        ? { id: match.id }
        : { id: null, error: `Manage Questions preset "${name}" is not available.` };
}

export function buildSessionPresetImportPreview(
    manifest: SessionPresetManifest,
    options: SessionPresetImportOptions,
): SessionPresetImportPreview {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rows: SessionPresetImportRow[] = manifest.presets.map((preset) => {
        const resolved = resolveManagePreset(preset.managePresetName, options);
        const config = { ...preset.config, managePresetId: resolved.id ?? 'all' };
        return {
            name: preset.name,
            mode: preset.mode,
            managePresetName: preset.managePresetName,
            managePresetId: resolved.id,
            status: resolved.error ? 'manage-missing' : 'ready',
            message: resolved.error ?? 'Ready to import.',
            config: resolved.error ? null : config,
            showOnStart: preset.showOnStart ?? true,
        };
    });
    if (options.managePresets.length === 0) {
        warnings.push(
            'No Manage Questions presets exist. Only All questions / Last custom references can import.',
        );
    }
    return { rows, errors, warnings };
}

function uniqueSessionName(base: string, names: Set<string>): string {
    if (!names.has(base.toLowerCase())) return base;
    let n = 2;
    while (names.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
}

export async function applySessionPresetImport(
    options: SessionPresetApplyOptions,
): Promise<SessionPresetApplyResult> {
    const errors: string[] = [];
    const presets = options.existing.map((p) => ({ ...p, config: { ...p.config } }));
    const names = new Set(presets.map((p) => p.name.toLowerCase()));
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of options.preview.rows) {
        if (row.status !== 'ready' || !row.config) {
            skipped++;
            continue;
        }
        const existing = presets.find(
            (p) => p.name.toLowerCase() === row.name.toLowerCase(),
        );
        if (options.mode === 'update' && existing) {
            existing.mode = row.mode;
            existing.config = { ...row.config };
            existing.showOnStart = row.showOnStart;
            updated++;
            continue;
        }
        const name = uniqueSessionName(row.name, names);
        names.add(name.toLowerCase());
        presets.push({
            id: options.generateId(),
            name,
            mode: row.mode,
            config: { ...row.config },
            showOnStart: row.showOnStart ?? true,
        });
        added++;
    }

    try {
        await options.save(presets);
    } catch (e) {
        errors.push(`Could not save session presets: ${(e as Error).message}`);
    }
    return { added, updated, skipped, presets, errors };
}