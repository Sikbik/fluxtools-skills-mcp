import { describe, expect, it } from 'vitest';

import {
  bundledEndpointInventoryPath,
  loadBundledEndpointInventory,
  searchRoutes as searchRoutesFromCli,
  summarizeByCategory as summarizeByCategoryFromCli,
} from '../src/runtime/endpoints.js';
import {
  loadEndpointInventory,
  searchRoutes as searchRoutesFromMcp,
  summarizeByCategory as summarizeByCategoryFromMcp,
} from '../../flux-mcp/src/endpoints.js';

const routes = [
  {
    method: 'GET',
    path: '/apps/appstatus',
    category: 'apps',
    access: 'public',
    cache: null,
    localOnly: false,
    deprecated: false,
    comment: 'Get app status',
  },
  {
    method: 'POST',
    path: '/apps/appregister',
    category: 'apps',
    access: 'zelid',
    cache: null,
    localOnly: false,
    deprecated: false,
    comment: 'Register a Flux app',
  },
  {
    method: 'GET',
    path: '/daemon/getinfo',
    category: 'daemon',
    access: 'public',
    cache: 'short',
    localOnly: false,
    deprecated: false,
    comment: 'Get daemon info',
  },
];

describe('shared endpoint inventory parity', () => {
  it('matches MCP search and category summary behavior', () => {
    const searchOptions = {
      query: 'app',
      category: 'apps',
      access: 'public',
      method: 'GET',
      limit: 5,
    };

    expect(searchRoutesFromCli(routes, searchOptions)).toEqual(searchRoutesFromMcp(routes, searchOptions));
    expect(summarizeByCategoryFromCli(routes)).toEqual(summarizeByCategoryFromMcp(routes));
  });

  it('loads the bundled endpoint inventory through the CLI adapter', () => {
    const cliInventory = loadBundledEndpointInventory();
    const mcpInventory = loadEndpointInventory(bundledEndpointInventoryPath);

    expect(cliInventory).not.toBeNull();
    expect(mcpInventory).not.toBeNull();
    expect(cliInventory).toEqual(mcpInventory);

    const results = searchRoutesFromCli(cliInventory!.routes, { query: 'appregister', limit: 10 });
    expect(results.some((route) => route.path.includes('appregister'))).toBe(true);
  });
});
