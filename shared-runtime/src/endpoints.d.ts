export type FluxRoute = {
  method: string;
  path: string;
  category: string;
  access: string;
  cache: string | null;
  localOnly: boolean;
  deprecated: boolean;
  comment: string;
  source?: { file: string; line: number };
};

export type FluxEndpointInventory = {
  generatedAt: string;
  sourceCommit?: string;
  sourceRef?: string;
  sourceFile: string;
  routeCount: number;
  routes: FluxRoute[];
};

export function loadEndpointInventory(filePath: string): FluxEndpointInventory | null;

export function summarizeByCategory(routes: FluxRoute[]): Array<{ category: string; count: number }>;

export function searchRoutes(
  routes: FluxRoute[],
  opts: {
    query?: string;
    category?: string;
    access?: string;
    method?: string;
    limit?: number;
  }
): FluxRoute[];
