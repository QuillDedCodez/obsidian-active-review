/**
 * Click-and-drag list reordering.
 *
 * Adapted from Obsidian's own settings-list reorder gesture so plugin lists
 * behave like Settings → Interface → Ribbon menu: the held row follows the
 * pointer as a floating ghost, the remaining rows animate out of the way, and
 * the ghost settles into the freed slot on release.
 */
import { Platform } from 'obsidian';

export interface ReorderPosition {
    listEl: HTMLElement;
    index: number;
}

export interface ReorderOptions {
    /** Direct children of the list that participate in reordering. */
    itemSelector: string;
    /** Only start a drag from this descendant of an item. Defaults to the item. */
    handleSelector?: string;
    /** Pointer travel before a mouse drag starts. */
    tolerance?: number;
    /** Optional extra lists that can accept the dragged item. */
    getDropLists?: () => HTMLElement[];
    onStart?: (item: HTMLElement, ghostEl: HTMLElement) => void;
    onDragMove?: (item: HTMLElement, position: ReorderPosition) => void;
    onEnd?: (item: HTMLElement, from: ReorderPosition, to: ReorderPosition) => void;
}

type PointLike = { clientX: number; clientY: number };

interface GestureSession {
    move(event: Event, point: PointLike): boolean;
    end(event: Event, point: PointLike): void;
}

type GestureHandler = (event: Event, point: PointLike) => GestureSession | null;

interface DragState {
    draggedEl: HTMLElement;
    listEls: HTMLElement[];
    itemSelector: string;
    isRtl: boolean;
}

interface DropTarget {
    listEl: HTMLElement;
    nextItemEl: HTMLElement | null;
    index: number;
    x: number;
    y: number;
}

interface Ghost {
    ghostEl: HTMLElement;
    cloneEl: HTMLElement;
}

const HOLD_DELAY = 250;
const HOLD_VIBRATE = 200;
const DEFAULT_TOLERANCE = 5;
const SETTLE_DURATION = 300;
const SETTLE_DURATION_MIN = 150;
const SETTLE_DURATION_MAX = 320;
const FLIP_DURATION = 300;
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const AUTO_SCROLL_EDGE = 50;
const AUTO_SCROLL_MAX = 15;
const VELOCITY_FRICTION = 0.5;
const AUTO_SCROLL_FRICTION = 0.2;

const activeFlips = new WeakMap<HTMLElement, Animation>();

function isShown(el: HTMLElement): boolean {
    return el.getClientRects().length > 0;
}

function getListItems(listEl: HTMLElement, selector: string): HTMLElement[] {
    return Array.from(
        listEl.querySelectorAll<HTMLElement>(`:scope > :is(${selector})`),
    ).filter(isShown);
}

function findTouch(event: TouchEvent, id: number): Touch | null {
    for (const touch of Array.from(event.changedTouches)) {
        if (touch.identifier === id) return touch;
    }
    for (const touch of Array.from(event.touches)) {
        if (touch.identifier === id) return touch;
    }
    return null;
}

function findScrollParent(el: HTMLElement): HTMLElement {
    const parent = el.parentElement;
    if (!parent) return el;
    return parent.scrollHeight > parent.clientHeight
        ? parent
        : findScrollParent(parent);
}

function collectCustomProps(item: HTMLElement, win: Window): Record<string, string> {
    const computed = win.getComputedStyle(item);
    const body = win.getComputedStyle(item.ownerDocument.body);
    const props: Record<string, string> = {};
    for (let i = 0; i < computed.length; i++) {
        const name = computed[i];
        if (!name || !name.startsWith('--')) continue;
        const value = computed.getPropertyValue(name);
        if (value !== body.getPropertyValue(name)) props[name] = value;
    }
    return props;
}

function createGhost(item: HTMLElement, customProps: Record<string, string>): Ghost {
    const ghostEl = createDiv({ cls: 'rv-reorder-ghost' });
    const cloneEl = item.cloneNode(true) as HTMLElement;
    cloneEl.removeAttribute('aria-label');
    cloneEl.classList.add('rv-reorder-dragged-item');
    cloneEl.style.setProperty('width', `${item.offsetWidth}px`);
    cloneEl.style.setProperty('height', `${item.offsetHeight}px`);
    for (const [name, value] of Object.entries(customProps)) {
        cloneEl.style.setProperty(name, value);
    }
    ghostEl.appendChild(cloneEl);
    return { ghostEl, cloneEl };
}

/** Measure all items, run the DOM change, then animate old → new positions. */
function flipItems(elements: HTMLElement[]): () => void {
    const before = elements.map((el) => el.getBoundingClientRect());
    return () => {
        if (elements.length === 0) return;
        for (const el of elements) {
            activeFlips.get(el)?.cancel();
            activeFlips.delete(el);
        }
        const after = elements.map((el) => el.getBoundingClientRect());
        elements.forEach((el, index) => {
            const dx = before[index]!.left - after[index]!.left;
            const dy = before[index]!.top - after[index]!.top;
            if (dx === 0 && dy === 0) return;
            const animation = el.animate(
                [
                    { transform: `translate(${dx}px, ${dy}px)` },
                    { transform: 'translate(0, 0)' },
                ],
                { duration: FLIP_DURATION, easing: FLIP_EASING },
            );
            activeFlips.set(el, animation);
            animation.onfinish = () => {
                if (activeFlips.get(el) === animation) activeFlips.delete(el);
            };
        });
    };
}

function collectDropTargets(state: DragState): DropTarget[] {
    const targets: DropTarget[] = [];
    const { draggedEl: draggedEl } = state;
    const parent = draggedEl.parentElement;
    const next = draggedEl.nextElementSibling;
    for (const listEl of state.listEls) {
        if (!isShown(listEl) || draggedEl.contains(listEl)) continue;
        listEl.appendChild(draggedEl);
        const items = getListItems(listEl, state.itemSelector);
        let index = 0;
        for (const item of items) {
            if (item === draggedEl) continue;
            const rect = item.getBoundingClientRect();
            targets.push({
                listEl,
                nextItemEl: item,
                index,
                x: state.isRtl ? rect.right : rect.left,
                y: rect.top,
            });
            index++;
        }
        const rect = draggedEl.getBoundingClientRect();
        targets.push({
            listEl,
            nextItemEl: null,
            index,
            x: state.isRtl ? rect.right : rect.left,
            y: rect.top,
        });
    }
    if (parent) parent.insertBefore(draggedEl, next);
    return targets;
}

function findNearestTarget(
    targets: DropTarget[],
    fallback: DropTarget,
    x: number,
    y: number,
): DropTarget {
    const distance = (target: DropTarget) => {
        const dx = target.x - x;
        const dy = target.y - y;
        return dx * dx + dy * dy;
    };
    let nearest = fallback;
    let best = distance(fallback);
    for (const target of targets) {
        const value = distance(target);
        if (value < best) {
            best = value;
            nearest = target;
        }
    }
    return nearest;
}

function measureScrollSignature(state: DragState, scrollTop: number): number {
    let signature = 0;
    for (const listEl of state.listEls) {
        if (!isShown(listEl) || state.draggedEl.contains(listEl)) continue;
        const rect = listEl.getBoundingClientRect();
        signature += 1 + rect.height + rect.top + scrollTop;
    }
    return signature;
}

function allListItems(state: DragState): HTMLElement[] {
    const items: HTMLElement[] = [];
    for (const listEl of state.listEls) {
        for (const item of getListItems(listEl, state.itemSelector)) {
            if (item !== state.draggedEl) items.push(item);
        }
    }
    return items;
}

function lerp(from: number, to: number, factor: number): number {
    return from * factor + to * (1 - factor);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function settleGhost(
    ghost: Ghost,
    item: HTMLElement,
    win: Window,
    duration: number,
): void {
    const rect = item.getBoundingClientRect();
    const current = win.getComputedStyle(ghost.ghostEl).transform;
    ghost.ghostEl.classList.add('is-settling');
    ghost.cloneEl.classList.remove('rv-reorder-held');
    const animation = ghost.ghostEl.animate(
        [
            { transform: current === 'none' ? 'translate(0, 0)' : current },
            { transform: `translate(${rect.left}px, ${rect.top}px)` },
        ],
        { duration, easing: FLIP_EASING },
    );
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        ghost.ghostEl.remove();
        item.classList.remove('rv-reorder-hidden');
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
    // Keep the hidden row from lingering if the window is backgrounded and
    // the animation never advances.
    window.setTimeout(finish, duration + 100);
}

function beginReorder(
    event: Event,
    point: PointLike,
    listEl: HTMLElement,
    item: HTMLElement,
    options: ReorderOptions,
): GestureSession | null {
    const itemSelector = options.itemSelector;
    const initialItems = getListItems(listEl, itemSelector);
    const initialPosition: ReorderPosition = {
        listEl,
        index: initialItems.indexOf(item),
    };
    if (initialPosition.index === -1) return null;
    if (!options.getDropLists && initialItems.length < 2) return null;

    // Use the window that dispatched the event, not the window captured when
    // the list was built. Obsidian may move a Settings page between documents
    // after `display()` runs, so a captured window can be stale.
    const eventDoc =
        (event as unknown as { doc?: Document }).doc ??
        listEl.ownerDocument;
    const doc = eventDoc;
    const win =
        (event as unknown as { win?: Window }).win ??
        eventDoc.defaultView ??
        window;
    const startX = point.clientX;
    const startY = point.clientY;
    const originalNext = item.nextElementSibling;
    const itemRect = item.getBoundingClientRect();
    const offsetX = startX - itemRect.left;
    const offsetY = startY - itemRect.top;
    const isRtl = win.getComputedStyle(item).direction === 'rtl';
    const scrollEl = findScrollParent(listEl);
    const scrollRect = scrollEl.getBoundingClientRect();
    const isTouch = event instanceof TouchEvent;
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const toleranceSq = tolerance * tolerance;

    let active = !isTouch;
    let thresholdReached = tolerance === 0;
    let lastX = startX;
    let lastY = startY;
    let lastTime = event.timeStamp;
    let velocityX = 0;
    let velocityY = 0;
    let current = initialPosition;
    let dragState: DragState | null = null;
    let dropTargets: DropTarget[] = [];
    let currentTarget: DropTarget | null = null;
    let scrollTop = scrollEl.scrollTop;
    let measuredScrollTop = scrollTop;
    let scrollSignature = -1;
    let autoScrollVelocity = 0;
    let autoScrollStep = 0;
    let itemWidth = 0;
    let itemHeight = 0;
    let customProps: Record<string, string> = {};
    let ghost: Ghost | null = null;
    let held = false;
    let holdTimer: number | null = null;
    let autoScrollTimer: number | null = null;

    function clearHoldTimer(): void {
        if (holdTimer !== null) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    function startHold(): void {
        if (held) return;
        held = true;
        customProps = collectCustomProps(item, win);
        item.classList.add('rv-reorder-held');
    }

    function endHold(): void {
        if (!held) return;
        held = false;
        item.classList.remove('rv-reorder-held');
    }

    function positionGhost(x: number, y: number): void {
        if (!ghost) return;
        ghost.ghostEl.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
    }

    function onScroll(): void {
        scrollTop = scrollEl.scrollTop;
    }

    function refreshTargets(): void {
        if (!dragState) return;
        const signature = measureScrollSignature(dragState, scrollTop);
        if (Math.abs(signature - scrollSignature) < 0.5) return;
        const parent = item.parentElement;
        const index = parent ? getListItems(parent, itemSelector).indexOf(item) : -1;
        dropTargets = collectDropTargets(dragState);
        scrollSignature = signature;
        measuredScrollTop = scrollTop;
        scrollEl.scrollTop = scrollTop;
        currentTarget = dropTargets.find(
            (target) => target.listEl === parent && target.index === index,
        ) ?? null;
    }

    function moveTo(x: number, y: number): ReorderPosition {
        if (!dragState || !ghost) return current;
        options.onDragMove?.(item, current);
        refreshTargets();
        if (!currentTarget) return current;

        const pointerX = isRtl ? x - offsetX + itemWidth : x - offsetX;
        const pointerY = y - offsetY + scrollTop - measuredScrollTop;
        const target = findNearestTarget(dropTargets, currentTarget, pointerX, pointerY);
        if (target === currentTarget) return current;

        const flip = flipItems(allListItems(dragState));
        item.remove();
        target.listEl.insertBefore(item, target.nextItemEl);
        scrollEl.scrollTop = scrollTop;
        const nextPosition: ReorderPosition = {
            listEl: target.listEl,
            index: target.index,
        };
        current = nextPosition;
        currentTarget = target;
        scrollSignature = measureScrollSignature(dragState, scrollTop);
        flip();
        if (Platform.isMobile) {
            try {
                navigator.vibrate?.(0);
            } catch {
                // Haptics are optional.
            }
        }
        return nextPosition;
    }

    function updateAutoScroll(y: number): void {
        const edge = Math.min(AUTO_SCROLL_EDGE, scrollRect.height / 3);
        const top = scrollRect.top + edge;
        const bottom = scrollRect.bottom - edge;
        const pointerTop = y - offsetY;
        const pointerBottom = pointerTop + itemHeight;
        if (pointerTop < top) {
            autoScrollVelocity = (pointerTop - top) / edge;
        } else if (pointerBottom > bottom) {
            autoScrollVelocity = (pointerBottom - bottom) / edge;
        } else {
            autoScrollVelocity = 0;
            autoScrollStep = 0;
        }
        autoScrollVelocity = clamp(autoScrollVelocity, -1, 1) * AUTO_SCROLL_MAX;
    }

    function autoScrollTick(): void {
        if (!dragState) return;
        if (autoScrollVelocity === 0) return;
        autoScrollStep = lerp(autoScrollStep, autoScrollVelocity, AUTO_SCROLL_FRICTION);
        scrollEl.scrollTop = scrollTop + autoScrollStep;
        scrollTop = scrollEl.scrollTop;
        moveTo(lastX, lastY);
    }

    function startGhost(): void {
        itemWidth = item.offsetWidth;
        itemHeight = item.offsetHeight;
        scrollTop = scrollEl.scrollTop;
        measuredScrollTop = scrollTop;
        const extraLists = options.getDropLists?.() ?? [];
        const listEls = extraLists.includes(listEl)
            ? extraLists
            : [...extraLists, listEl];
        dragState = {
            draggedEl: item,
            listEls,
            itemSelector,
            isRtl,
        };
        ghost = createGhost(item, customProps);
        options.onStart?.(item, ghost.ghostEl);
        doc.body.appendChild(ghost.ghostEl);
        if (event instanceof PointerEvent) {
            try {
                ghost.ghostEl.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture is unavailable on some platforms.
            }
        }
        doc.body.classList.add('rv-reorder-grabbing');
        item.classList.add('rv-reorder-hidden');
        endHold();
        positionGhost(lastX, lastY);
        scrollEl.addEventListener('scroll', onScroll);
        autoScrollTimer = window.setInterval(autoScrollTick, 1000 / 60);
    }

    if (isTouch) {
        holdTimer = window.setTimeout(() => {
            holdTimer = null;
            if (thresholdReached) return;
            active = true;
            startHold();
            if (Platform.isMobile) {
                try {
                    navigator.vibrate?.(HOLD_VIBRATE);
                } catch {
                    // Haptics are optional.
                }
            }
            doc.getSelection()?.removeAllRanges();
        }, HOLD_DELAY);
    }

    return {
        move(moveEvent, movePoint): boolean {
            const now = moveEvent.timeStamp;
            const elapsed = now - lastTime;
            if (elapsed > 0) {
                velocityX = lerp(velocityX, (movePoint.clientX - lastX) / elapsed, VELOCITY_FRICTION);
                velocityY = lerp(velocityY, (movePoint.clientY - lastY) / elapsed, VELOCITY_FRICTION);
            }
            lastTime = now;
            lastX = movePoint.clientX;
            lastY = movePoint.clientY;

            if (!thresholdReached) {
                const dx = lastX - startX;
                const dy = lastY - startY;
                thresholdReached = dx * dx + dy * dy >= toleranceSq;
            }
            if (!active || !thresholdReached) return true;

            moveEvent.preventDefault();
            if (!ghost) {
                startGhost();
                return true;
            }
            updateAutoScroll(lastY);
            moveTo(lastX, lastY);
            positionGhost(lastX, lastY);
            return true;
        },

        end(endEvent, endPoint): void {
            clearHoldTimer();
            if (!ghost) {
                endHold();
                return;
            }
            endEvent.preventDefault();
            if (endEvent.timeStamp - lastTime > 80) {
                velocityX = 0;
                velocityY = 0;
            }

            const finalPosition = moveTo(endPoint.clientX, endPoint.clientY);
            const remaining = getListItems(listEl, itemSelector);
            const remainingCount = remaining.length - (remaining.includes(item) ? 1 : 0);
            const changedLists = remainingCount !== initialItems.length - 1;

            if (changedLists && initialPosition.listEl) {
                const parent = initialPosition.listEl;
                if (originalNext && originalNext.parentElement === parent) {
                    parent.insertBefore(item, originalNext);
                } else {
                    parent.appendChild(item);
                }
            }

            doc.body.classList.remove('rv-reorder-grabbing');
            if (autoScrollTimer !== null) {
                window.clearInterval(autoScrollTimer);
                autoScrollTimer = null;
            }
            scrollEl.removeEventListener('scroll', onScroll);
            endHold();

            options.onEnd?.(
                item,
                initialPosition,
                changedLists ? initialPosition : finalPosition,
            );

            const finishedGhost = ghost;
            ghost = null;
            if (finishedGhost) {
                const speed = Math.hypot(velocityX, velocityY);
                const duration = clamp(
                    SETTLE_DURATION - speed * 40,
                    SETTLE_DURATION_MIN,
                    SETTLE_DURATION_MAX,
                );
                settleGhost(finishedGhost, item, win, duration);
            } else {
                item.classList.remove('rv-reorder-hidden');
            }
        },
    };
}

function attachGesture(container: HTMLElement, handler: GestureHandler): () => void {
    function gestureWindow(event: Event): Window {
        const target = event.target;
        const targetDoc =
            target instanceof Node ? target.ownerDocument : container.ownerDocument;
        return (
            (event as unknown as { win?: Window }).win ??
            targetDoc?.defaultView ??
            container.ownerDocument.defaultView ??
            window
        );
    }

    function onPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || event.pointerType !== 'mouse') return;
        const session = handler(event, event);
        if (!session) return;
        const win = gestureWindow(event);
        const activeSession = session;
        const pointerId = event.pointerId;
        let finished = false;
        let lastEvent: PointerEvent = event;
        function cleanup(): void {
            win.removeEventListener('pointermove', onMove, true);
            win.removeEventListener('pointerup', onUp, true);
            win.removeEventListener('pointercancel', onCancel, true);
            win.removeEventListener('blur', onBlur);
        }
        function onMove(moveEvent: PointerEvent): void {
            if (moveEvent.pointerId !== pointerId) return;
            lastEvent = moveEvent;
            if (!activeSession.move(moveEvent, moveEvent)) finish();
        }
        function onUp(upEvent: PointerEvent): void {
            if (upEvent.pointerId !== pointerId) return;
            lastEvent = upEvent;
            finish();
        }
        function onCancel(cancelEvent: PointerEvent): void {
            if (cancelEvent.pointerId !== pointerId) return;
            finish();
        }
        function onBlur(): void {
            finish();
        }
        function finish(): void {
            if (finished) return;
            finished = true;
            cleanup();
            activeSession.end(lastEvent, lastEvent);
        }
        win.addEventListener('pointermove', onMove, true);
        win.addEventListener('pointerup', onUp, true);
        win.addEventListener('pointercancel', onCancel, true);
        win.addEventListener('blur', onBlur);
    }

    function onTouchStart(event: TouchEvent): void {
        if (event.touches.length > 1) return;
        const touch = event.touches[0];
        if (!touch) return;
        const session = handler(event, touch);
        if (!session) return;
        const win = gestureWindow(event);
        const activeSession = session;
        const id = touch.identifier;
        function remove(): void {
            container.removeEventListener('contextmenu', suppressContextMenu, true);
            win.removeEventListener('touchcancel', onEnd, true);
            win.removeEventListener('touchend', onEnd, true);
            win.removeEventListener('touchmove', onMove, true);
        }
        function onMove(moveEvent: TouchEvent): void {
            const moved = findTouch(moveEvent, id);
            if (!moved) return;
            if (!activeSession.move(moveEvent, moved)) remove();
        }
        function onEnd(endEvent: TouchEvent): void {
            const ended = findTouch(endEvent, id);
            if (!ended) return;
            remove();
            activeSession.end(endEvent, ended);
        }
        function suppressContextMenu(menuEvent: Event): void {
            if (!menuEvent.isTrusted) return;
            menuEvent.preventDefault();
            menuEvent.stopImmediatePropagation();
        }
        container.addEventListener('contextmenu', suppressContextMenu, true);
        win.addEventListener('touchcancel', onEnd, true);
        win.addEventListener('touchend', onEnd, true);
        win.addEventListener('touchmove', onMove, { passive: false, capture: true });
    }

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => {
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('touchstart', onTouchStart);
    };
}

/**
 * Make the direct children matching `itemSelector` reorderable by dragging.
 * Returns a disposer that detaches the container listeners.
 */
export function attachListReorder(
    listEl: HTMLElement,
    options: ReorderOptions,
): () => void {
    return attachGesture(listEl, (event, point) => {
        const target = event.target;
        if (!(target instanceof Element)) return null;
        const item = target.closest<HTMLElement>(options.itemSelector);
        if (!item || item.parentElement !== listEl) return null;
        if (options.handleSelector) {
            const handle = target.closest<HTMLElement>(options.handleSelector);
            if (!handle || !item.contains(handle)) return null;
        }
        const control = target.closest(
            'input, textarea, select, button, [contenteditable], .cm-editor',
        );
        if (control && control !== item && item.contains(control)) return null;
        return beginReorder(event, point, listEl, item, options);
    });
}
