/**
 * One choice-grid measurement controller per screen.
 *
 * Each choice grid previously installed its own window resize listener, a
 * ResizeObserver on the list and every text element, and a MutationObserver.
 * With hundreds of cards, splitting the window triggered thousands of
 * callbacks and hundreds of forced measurements. The controller observes all
 * grids with a single ResizeObserver + IntersectionObserver, measures only
 * grids near the viewport, and debounces resize-driven work.
 */

interface Entry {
    list: HTMLElement;
    texts: HTMLElement[];
    visible: boolean;
    lastWidth: number;
}

const RESIZE_DEBOUNCE_MS = 120;
const VIEWPORT_MARGIN = '250px';

export class ChoiceLayoutController {
    private entries = new Map<HTMLElement, Entry>();
    private resizeObserver: ResizeObserver | null;
    private intersectionObserver: IntersectionObserver | null;
    private dirty = new Set<HTMLElement>();
    private frame: number | null = null;
    private resizeTimer: number | null = null;

    constructor() {
        this.resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver((changes) => {
                      for (const change of changes) {
                          const list = change.target as HTMLElement;
                          if (this.entries.has(list)) this.dirty.add(list);
                      }
                      this.scheduleResize();
                  });
        this.intersectionObserver =
            typeof IntersectionObserver === 'undefined'
                ? null
                : new IntersectionObserver(
                      (changes) => {
                          let refresh = false;
                          for (const change of changes) {
                              const list = change.target as HTMLElement;
                              const entry = this.entries.get(list);
                              if (!entry) continue;
                              entry.visible = change.isIntersecting;
                              if (change.isIntersecting) {
                                  this.dirty.add(list);
                                  refresh = true;
                              }
                          }
                          if (refresh) this.scheduleFrame();
                      },
                      { rootMargin: VIEWPORT_MARGIN },
                  );
    }

    observe(list: HTMLElement, texts: HTMLElement[]): void {
        if (this.entries.has(list)) return;
        const entry: Entry = {
            list,
            texts,
            visible: this.intersectionObserver === null,
            lastWidth: -1,
        };
        this.entries.set(list, entry);
        this.resizeObserver?.observe(list);
        this.intersectionObserver?.observe(list);
        if (this.intersectionObserver === null) {
            this.dirty.add(list);
            this.scheduleFrame();
        }
    }

    /** Lazy Markdown finished; re-check its choice grid. */
    markDirty(element: HTMLElement): void {
        const list = element.closest<HTMLElement>('.rv-choices');
        const entry = list ? this.entries.get(list) : undefined;
        if (!list || !entry) return;
        // Content changes do not change the list width, so bypass the width
        // latch on the next measurement.
        entry.lastWidth = -1;
        this.dirty.add(list);
        this.scheduleFrame();
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        this.intersectionObserver?.disconnect();
        if (this.resizeTimer !== null) {
            window.clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        }
        if (this.frame !== null) {
            window.cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        this.entries.clear();
        this.dirty.clear();
    }

    private scheduleResize(): void {
        if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
            this.resizeTimer = null;
            this.scheduleFrame();
        }, RESIZE_DEBOUNCE_MS);
    }

    private scheduleFrame(): void {
        if (this.frame !== null) return;
        this.frame = window.requestAnimationFrame(() => {
            this.frame = null;
            this.process();
        });
    }

    private process(): void {
        const lists = [...this.dirty];
        this.dirty.clear();
        for (const list of lists) {
            const entry = this.entries.get(list);
            if (!entry || !entry.visible) continue;
            this.measure(entry);
        }
    }

    private measure(entry: Entry): void {
        const { list, texts } = entry;
        const width = list.clientWidth;
        if (width === 0) return;
        if (Math.abs(width - entry.lastWidth) <= 1) return;
        entry.lastWidth = width;

        const listStyle = window.getComputedStyle(list);
        const columnGap = parseFloat(listStyle.columnGap) || 0;
        const track = Math.max(1, (width - columnGap) / 2);
        const first = list.querySelector<HTMLElement>(':scope > .rv-choice');
        let available = track;
        if (first) {
            const style = window.getComputedStyle(first);
            const padding =
                (parseFloat(style.paddingLeft) || 0) +
                (parseFloat(style.paddingRight) || 0);
            const letter = first.querySelector<HTMLElement>('.rv-letter');
            const letterWidth = letter?.getBoundingClientRect().width ?? 0;
            const innerGap = parseFloat(style.columnGap) || 0;
            available = Math.max(1, track - padding - letterWidth - innerGap);
        }

        list.classList.add('is-measuring');
        let natural = 0;
        for (const text of texts) {
            natural = Math.max(natural, text.scrollWidth);
        }
        list.classList.remove('is-measuring');

        const stacked = list.classList.contains('is-stacked');
        if (!stacked && natural > available + 1) {
            list.classList.add('is-stacked');
        } else if (stacked && natural < available - 8) {
            list.classList.remove('is-stacked');
        }
    }
}
