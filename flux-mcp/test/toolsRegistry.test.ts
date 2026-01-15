import { describe, expect, it } from 'vitest';

import { tools } from '../src/index.js';

function getRequired(schema: unknown): string[] | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const value = (schema as Record<string, unknown>).required;
  if (!Array.isArray(value)) return undefined;
  if (value.some((x) => typeof x !== 'string')) return undefined;
  return value as string[];
}

describe('MCP tool registry', () => {
  it('includes auth and UX tools', () => {
    const names = new Set(tools.map((t) => t.name));

    expect(names.has('flux_auth_flow')).toBe(true);
    expect(names.has('flux_auth_diagnose')).toBe(true);
    expect(names.has('flux_set_http_defaults')).toBe(true);

    expect(names.has('flux_get_emergency_phrase')).toBe(true);
    expect(names.has('flux_verify_login')).toBe(true);
    expect(names.has('flux_check_privilege')).toBe(true);

    expect(names.has('flux_logs_tail')).toBe(true);
    expect(names.has('flux_app_health_report')).toBe(true);
    expect(names.has('flux_resource_prune')).toBe(true);

    expect(names.has('flux_apps_list_global_specs')).toBe(true);
    expect(names.has('flux_apps_list_by_zelid_with_expiry')).toBe(true);
    expect(names.has('flux_apps_global_status')).toBe(true);
    expect(names.has('flux_apps_troubleshoot')).toBe(true);
    expect(names.has('flux_apps_register_and_verify')).toBe(true);
    expect(names.has('flux_apps_update_and_verify')).toBe(true);
    expect(names.has('flux_explorer_height_info')).toBe(true);
    expect(names.has('flux_explorer_status')).toBe(true);
    expect(names.has('flux_explorer_balance_summary')).toBe(true);
    expect(names.has('flux_daemon_call')).toBe(true);
    expect(names.has('flux_daemon_get_info')).toBe(true);
    expect(names.has('flux_daemon_get_blockchain_info')).toBe(true);
    expect(names.has('flux_daemon_get_network_info')).toBe(true);
    expect(names.has('flux_daemon_get_peer_info')).toBe(true);
    expect(names.has('flux_daemon_get_mempool_info')).toBe(true);
    expect(names.has('flux_daemon_get_raw_mempool')).toBe(true);
    expect(names.has('flux_daemon_get_block_count')).toBe(true);
    expect(names.has('flux_daemon_get_connection_count')).toBe(true);
    expect(names.has('flux_daemon_get_difficulty')).toBe(true);
    expect(names.has('flux_explorer_restart')).toBe(true);
    expect(names.has('flux_explorer_stop')).toBe(true);
    expect(names.has('flux_explorer_reindex')).toBe(true);
    expect(names.has('flux_explorer_rescan')).toBe(true);
    expect(names.has('flux_backup_get_volume_data')).toBe(true);
    expect(names.has('flux_backup_get_remote_file_size')).toBe(true);
    expect(names.has('flux_backup_list_local')).toBe(true);
    expect(names.has('flux_backup_remove_file')).toBe(true);
    expect(names.has('flux_backup_download_local_file')).toBe(true);
  });

  it('defines required args for key tools', () => {
    const verify = tools.find((t) => t.name === 'flux_verify_login');
    const check = tools.find((t) => t.name === 'flux_check_privilege');

    expect(verify).toBeTruthy();
    expect(check).toBeTruthy();

    const verifyReq = getRequired(verify?.inputSchema);
    const checkReq = getRequired(check?.inputSchema);

    expect(verifyReq).toEqual(['zelid', 'signature', 'loginPhrase']);
    expect(checkReq).toEqual(['zelid', 'signature', 'loginPhrase']);

    const listGlobal = tools.find((t) => t.name === 'flux_apps_list_global_specs');
    const globalStatus = tools.find((t) => t.name === 'flux_apps_global_status');
    const byZelid = tools.find((t) => t.name === 'flux_apps_list_by_zelid_with_expiry');

    expect(listGlobal).toBeTruthy();
    expect(globalStatus).toBeTruthy();
    expect(byZelid).toBeTruthy();

    expect(getRequired(listGlobal?.inputSchema)).toBeUndefined();
    expect(getRequired(globalStatus?.inputSchema)).toBeUndefined();
    expect(getRequired(byZelid?.inputSchema)).toBeUndefined();

    const byZelidSchema = byZelid?.inputSchema as Record<string, unknown> | undefined;
    const byZelidProps = byZelidSchema?.properties as Record<string, unknown> | undefined;
    expect(byZelidProps && 'includeExpired' in byZelidProps).toBe(true);
    expect(byZelidProps && 'limit' in byZelidProps).toBe(true);
  });
});
