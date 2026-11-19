/** User session presets stored in data.json. */
import type { SessionConfig } from '../constants';
import type { Mode } from '../session';

export interface SessionPreset {
    id: string;
    name: string;
    mode: Mode;
    config: SessionConfig;
    /** Whether this preset appears on the start screen. Hidden presets stay saved and remain usable elsewhere. */
    showOnStart: boolean;
}