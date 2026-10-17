// Lists (docs/DESIGN.md section 8): `limit` and `offset` in, `{count, next,
// previous, results}` out. A page carries every field of the list response plus
// helpers; `for await` walks every item of every page by following `next`.

import { APIPromise, type RawResponse } from "./api-promise.js";
import { DiditError } from "./errors.js";

/** The fields every list response has. */
export interface PageResponse<Item> {
  count?: number | null;
  next?: string | null;
  previous?: string | null;
  results?: Item[] | null;
}

/** Fetches the page a `next` link points to. */
export type PageFetcher<R, Item> = (next: string, current: Page<R, Item>) => Promise<Page<R, Item>>;

/** The helpers on every page. */
export interface PageMethods<R, Item> extends AsyncIterable<Item> {
  /** Whether the API returned a `next` link. */
  hasNextPage(): boolean;
  /** The page `next` points to. Throws when there is none. */
  getNextPage(): Promise<Page<R, Item>>;
  /** This page and every following page. */
  iterPages(): AsyncGenerator<Page<R, Item>, void, undefined>;
  /** Every item of this page and the following pages. */
  [Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined>;
}

/** One page of a list: the list response's fields plus the page helpers. */
export type Page<R, Item> = R & PageMethods<R, Item>;

class PageImpl<R, Item> implements PageMethods<R, Item> {
  readonly #fetchNext: PageFetcher<R, Item>;

  constructor(body: R, fetchNext: PageFetcher<R, Item>) {
    Object.assign(this, body);
    this.#fetchNext = fetchNext;
  }

  #next(): string | null {
    const next = (this as unknown as PageResponse<Item>).next;
    return typeof next === "string" && next !== "" ? next : null;
  }

  hasNextPage(): boolean {
    return this.#next() !== null;
  }

  getNextPage(): Promise<Page<R, Item>> {
    const next = this.#next();
    if (next === null) {
      return Promise.reject(new DiditError("This is the last page: there is no next link."));
    }
    return this.#fetchNext(next, this as unknown as Page<R, Item>);
  }

  async *iterPages(): AsyncGenerator<Page<R, Item>, void, undefined> {
    let page = this as unknown as Page<R, Item>;
    for (;;) {
      yield page;
      if (!page.hasNextPage()) return;
      page = await page.getNextPage();
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    for await (const page of this.iterPages()) {
      const results = (page as PageResponse<Item>).results;
      if (Array.isArray(results)) yield* results;
    }
  }
}

/** Build a page from a list response body. */
export function makePage<R, Item>(body: R, fetchNext: PageFetcher<R, Item>): Page<R, Item> {
  return new PageImpl<R, Item>(body, fetchNext) as unknown as Page<R, Item>;
}

/**
 * The result of a list method: await it for the first page, or iterate it with
 * `for await` for every item of every page.
 *
 * ```ts
 * const page = await didit.sessions.list({ limit: 50 });
 * for await (const session of didit.sessions.list()) console.log(session.session_id);
 * ```
 */
export class PagePromise<R, Item> extends APIPromise<Page<R, Item>> implements AsyncIterable<Item> {
  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    const page = await this;
    yield* page;
  }
}

export type { RawResponse };
