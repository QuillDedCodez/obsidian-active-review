/** vault: everything that touches the Obsidian vault. This file is the folder's public API. */
export {
    VaultScanner,
    registerVaultEvents,
    type ScanEntry,
    type ScanFileStat,
    type ScanResult,
    type VaultChange,
    type VaultChangeHandler,
    type VaultPaths,
} from './scanner';
export { SessionIndex, isSessionFilePath, type SessionIndexEntry } from './sessionIndex';
export { VaultIndexStore } from './vaultIndex';
export {
    INDEX_SCHEMA,
    emptyIndexData,
    decodeIndexData,
    encodeIndexData,
    type IndexedQuestion,
    type IndexedSession,
    type IndexedVerdict,
    type VaultIndexData,
    type VaultIndexScope,
} from './indexCodec';
export {
    writeSessionFile,
    updateSessionFile,
    deleteSession,
    renameSession,
    archiveSession,
    unarchiveSession,
    appendReproducedInto,
    generateSessionId,
    sessionLabel,
    serializeSessionLog,
    parseSessionLog,
    snapshotFromConfig,
    configFromSnapshot,
    type SessionLogState,
    type SessionLogPreview,
    type SessionAnswerEntry,
    type SessionSnapshot,
    type SessionSummary,
    type RoundEntry,
    type RoundAction,
    type SessionStatus,
    type PendingSessionFile,
} from './sessionLog';
export { ensureFolder, scanReviewFolders } from './folders';
export {
    SessionHub,
    SharedSession,
    type SharedSessionEvent,
    type SharedChangeKind,
} from './sessionHub';
export {
    categoriesEqualCI,
    resolveCategoryCasing,
    moveFileToCategory,
    deleteCategoryFolder,
    addCategoryFolder,
    type FileMove,
    type MoveCategoryResult,
    type DeleteFolderResult,
} from './manageFolders';
export {
    planFolderSync,
    applyFolderSync,
    planCategorySync,
    applyCategorySync,
    type SyncPlan,
    type UpdatePlan,
} from './syncCategory';