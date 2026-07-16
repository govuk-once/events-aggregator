export interface SearchResult {
  link: string;
  title: string;
  public_timestamp: string;
  content_id?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface ChangeHistoryEntry {
  note: string;
  public_timestamp: string;
}

export interface ContentApiResponse {
  content_id: string;
  title: string;
  base_path: string;
  details: {
    change_description?: string;
    change_history?: ChangeHistoryEntry[];
    country?: {
      name: string;
      slug: string;
    };
  };
}
