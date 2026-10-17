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

/**
 * Fetches the page a `next` link points to. `seen` holds the absolute URLs
 * already visited in this walk; a link back to one of them is refused.
 */
export type PageFetcher<R, Item> = (next: string, seen: Set<string>) => Promise<Page<R, Item>>;

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
  readonly #url: string;

  constructor(body: R, url: string, fetchNext: PageFetcher<R, Item>) {
    Object.assign(this, body);
    this.#url = url;
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
    return this.#nextPage(new Set([this.#url]));
  }

  #nextPage(seen: Set<string>): Promise<Page<R, Item>> {
    const next = this.#next();
    if (next === null) {
      return Promise.reject(new DiditError("This is the last page: there is no next link."));
    }
    return this.#fetchNext(next, seen);
  }

  async *iterPages(): AsyncGenerator<Page<R, Item>, void, undefined> {
    // One set per walk, so a cycle of next links ends it instead of looping forever.
    const seen = new Set([this.#url]);
    let page: PageImpl<R, Item> = this;
    for (;;) {
      yield page as unknown as Page<R, Item>;
      if (!page.hasNextPage()) return;
      page = (await page.#nextPage(seen)) as unknown as PageImpl<R, Item>;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined> {
    for await (const page of this.iterPages()) {
      const results = (page as PageResponse<Item>).results;
      if (Array.isArray(results)) yield* results;
    }
  }
}

/** Build a page from a list response body fetched from `url`. */
export function makePage<R, Item>(
  body: R,
  url: string,
  fetchNext: PageFetcher<R, Item>,
): Page<R, Item> {
  return new PageImpl<R, Item>(body, url, fetchNext) as unknown as Page<R, Item>;
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
