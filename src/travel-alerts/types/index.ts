import z from 'zod';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly';

export type SearchResponseCountry = {
  link: string;
  public_timestamp: string;
  title: string;
  index: string;
  es_score: string;
  _id: string;
  elasticsearch_type: string;
  document_type: string;
};

export type SearchResponse = {
  results: SearchResponseCountry[];
};

export type ChangeHistory = {
  note: string;
  public_timestamp: string;
};

export type CountryDetails = {
  change_history: ChangeHistory[];
  country: {
    name: string;
    slug: string;
  };
};

export type CountryResponse = {
  details: CountryDetails;
};

export type NotificationPayload = {
  Subscription: string;
  NotificationTitle: string;
  NotificationBody: string;
  MessageTitle: string;
  MessageBody: string;
};

export async function parseResponseBody<Body>(
  response: Response,
): Promise<Body | undefined> {
  if (
    response.status === 204 ||
    response.headers.get('content-length') === '0'
  ) {
    return undefined;
  }

  const text = await response.text();

  if (!text) return undefined;

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as Body;
    } catch {
      return text as Body;
    }
  }

  return text as Body;
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: { status: number; message: string; body?: unknown } };

export async function typedFetch<T>(
  requestPromise: Promise<Response>,
  responseSchema?: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const res = await requestPromise;

  if (!res.ok) {
    const body = await parseResponseBody<{ message?: string }>(res);
    return {
      ok: false,
      error: {
        status: res.status,
        message: body?.message ?? res.statusText,
        body,
      },
    };
  }

  const rawBody = await parseResponseBody<unknown>(res);
  const parsed = responseSchema?.safeParse(rawBody) ?? {
    success: true,
    data: rawBody as T,
  };

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: 422,
        message: 'Response validation failed',
        body: z.treeifyError(parsed.error),
      },
    };
  }

  return { ok: true, status: res.status, data: parsed.data };
}

export type NumberUpTo<
  End extends number,
  Range extends number[] = [],
> = Range['length'] extends End
  ? Range[number]
  : NumberUpTo<End, [...Range, Range['length']]>;

  import { AsyncLocalStorage } from "node:async_hooks";

import type { Logger } from "@flex/logging";

import type { DomainIntegrations, RouteAuth } from "../types";

export interface RouteStore {
  readonly logger: Logger;
  readonly auth?: Readonly<RouteAuth>;
  readonly body?: unknown;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly queryParams?: Readonly<Record<string, unknown>>;
  readonly resources?: Readonly<Record<string, string>>;
  readonly featureFlags?: Readonly<Record<string, boolean>>;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly integrations?: DomainIntegrations;
}

export const routeStorage = new AsyncLocalStorage<RouteStore>();

export function getRouteStore(): RouteStore {
  const store = routeStorage.getStore();

  if (!store) {
    throw new Error(
      "Route store is not available. Must be called within a route handler",
    );
  }

  return store;
}
