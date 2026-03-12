import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEndpointInventory,
  searchRoutes,
  summarizeByCategory,
} from '../../../shared-runtime/src/endpoints.js';

export type { FluxEndpointInventory, FluxRoute } from '../../../shared-runtime/src/endpoints.js';
export { loadEndpointInventory, searchRoutes, summarizeByCategory } from '../../../shared-runtime/src/endpoints.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const bundledEndpointInventoryPath = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'flux-mcp',
  'data',
  'endpoints.json'
);

export function loadBundledEndpointInventory() {
  return loadEndpointInventory(bundledEndpointInventoryPath);
}
