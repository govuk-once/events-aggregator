import type { AwsCredentialIdentity } from '@aws-sdk/types';

export type FetchInit = RequestInit & { dispatcher?: unknown };

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
  Namespace: string;
  Group: string;
  Subgroup: string;
  NotificationTitle: string;
  NotificationBody: string;
  MessageTitle: string;
  MessageBody: string;
  DeeplinkURL?: string;
  Channel?: 'PUSH_NOTIFICATION_AND_MESSAGE_CENTRE' | 'MESSAGE_CENTRE_ONLY';
};

export type TravelAlertScheduleEvent = {
  triggeredAt: string;
  schedule: ScheduleFrequency;
  debugSuffix?: string;
};

export interface ConsumerConfig {
  apiKey: string;
  roleArn: string;
  /** Base URL of the private UNS API (e.g. https://xxxx.execute-api.<region>.amazonaws.com) */
  privateApiUrl: string;
  region: string;
}

export type NotificationStatus = 'RECEIVED' | 'READ' | 'MARKED_AS_UNREAD';

export interface NotificationPatchBody {
  Status: NotificationStatus;
}

/** Discriminated result — success or a structured error, never throws on HTTP status. */
export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: { status: number; message: string; body?: unknown } };

export type CredentialProvider = () => Promise<AwsCredentialIdentity>;
