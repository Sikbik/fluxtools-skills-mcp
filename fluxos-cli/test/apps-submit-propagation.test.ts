import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';

const MANAGED_ENV_KEYS = [
  'FLUXOS_CLI_STATE_DIR',
  'XDG_STATE_HOME',
  'FLUX_API_BASE_URL',
  'FLUX_ZELIDAUTH',
  'FLUX_ENTERPRISE_KEY',
  'FLUXDRIVE_MWS_BASE_URL',
  'FLUX_HTTP_TIMEOUT_MS',
  'FLUX_HTTP_RETRY_COUNT',
  'FLUX_HTTP_RETRY_BACKOFF_MS',
] as const;

function createCapture() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
        },
      },
    },
    getStdout() {
      return stdout;
    },
    getStderr() {
      return stderr;
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function createFluxRequestResult(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    data: {
      status: 'success',
      data,
    },
  };
}

function errorToolResult(message: string) {
  return {
    isError: true,
    structuredContent: { ok: false, error: message },
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }],
  };
}

function createAppsSubmissionRuntime(options?: {
  authenticated?: boolean;
  registerVerifyStatus?: 'submitted' | 'awaiting_payment' | 'verifying_global' | 'verified' | 'error';
  updateVerifyStatus?: 'submitted' | 'pending' | 'verifying_global' | 'verified' | 'error';
  registerVerifyThrowMessage?: string;
  updateVerifyThrowMessage?: string;
}) {
  const resources = new Map<string, { text: string; mimeType: string }>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const authenticated = options?.authenticated === true;

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  const setTextResource = (uri: string, text: string) => {
    resources.set(uri, { text, mimeType: 'text/plain' });
  };

  const messageMatrix: Record<string, { temporary: unknown; permanent: unknown }> = {
    'pending-hash': { temporary: [], permanent: [] },
    'temp-hash': { temporary: [{ hash: 'temp-hash', message: 'temporary' }], permanent: [] },
    'perm-hash': { temporary: [{ hash: 'perm-hash', message: 'temporary' }], permanent: [{ hash: 'perm-hash', message: 'permanent' }] },
    'reg-hash': { temporary: [{ hash: 'reg-hash', message: 'temporary' }], permanent: [] },
    'upd-hash': { temporary: [{ hash: 'upd-hash', message: 'temporary' }], permanent: [{ hash: 'upd-hash', message: 'permanent' }] },
    'reg-verify-hash': { temporary: [{ hash: 'reg-verify-hash', message: 'temporary' }], permanent: [] },
    'upd-verify-hash': { temporary: [{ hash: 'upd-verify-hash', message: 'temporary' }], permanent: [{ hash: 'upd-verify-hash', message: 'permanent' }] },
  };

  const runtime: ToolRuntime = {
    async listTools() {
      return [];
    },
    async callTool(name, rawArgs) {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? ({ ...rawArgs } as Record<string, unknown>)
        : {};
      calls.push({ name, args });

      switch (name) {
        case 'flux_apps_plan_registration': {
          const spec = asRecord(args.spec);
          const resourceUri = 'flux://resource/apps/plan-registration/full';
          const messageToSignResourceUri = 'flux://resource/apps/plan-registration/message';
          const summary = {
            ok: true,
            requiresAuth: !authenticated,
            authNote: authenticated ? null : 'Authenticate before submitting registration.',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            timestamp: Number(args.timestamp ?? 111),
            type: 'fluxappregister',
            typeVersion: Number(args.typeVersion ?? 1),
            payment: {
              address: 't1payment',
              amountFlux: 1.23,
              memo: '<REGISTRATION_HASH>',
              note: 'Pay after registration returns a hash.',
            },
            messageToSignSha256: 'register-sha',
            messageToSignBytes: 128,
            messageToSignResourceUri,
            resourceUri,
            nextActions: [{ tool: 'flux_apps_register', note: 'Submit registration after signing.' }],
          };

          setTextResource(messageToSignResourceUri, 'REGISTER-MESSAGE');
          setJsonResource(resourceUri, {
            ...summary,
            verified: createFluxRequestResult({ ...spec, verifiedFor: 'registration' }),
            price: createFluxRequestResult({ flux: 1.23, currency: 'FLUX' }),
            payload: {
              type: 'fluxappregister',
              version: Number(args.typeVersion ?? 1),
              timestamp: Number(args.timestamp ?? 111),
            },
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'plan-registration', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'register-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_plan_update': {
          const spec = asRecord(args.spec);
          const resourceUri = 'flux://resource/apps/plan-update/full';
          const messageToSignResourceUri = 'flux://resource/apps/plan-update/message';
          const summary = {
            ok: true,
            requiresAuth: !authenticated,
            authNote: authenticated ? null : 'Authenticate before submitting update.',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            timestamp: Number(args.timestamp ?? 222),
            type: 'fluxappupdate',
            typeVersion: Number(args.typeVersion ?? 2),
            payment: {
              address: 't1payment',
              amountFlux: 0.75,
              memo: '<UPDATE_HASH>',
              note: 'Pay after update submission returns a hash.',
            },
            messageToSignSha256: 'update-sha',
            messageToSignBytes: 144,
            messageToSignResourceUri,
            resourceUri,
            nextActions: [{ tool: 'flux_apps_update', note: 'Submit update after signing.' }],
          };

          setTextResource(messageToSignResourceUri, 'UPDATE-MESSAGE');
          setJsonResource(resourceUri, {
            ...summary,
            verified: createFluxRequestResult({ ...spec, verifiedFor: 'update' }),
            price: createFluxRequestResult({ flux: 0.75, currency: 'FLUX' }),
            payload: {
              type: 'fluxappupdate',
              version: Number(args.typeVersion ?? 2),
              timestamp: Number(args.timestamp ?? 222),
            },
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for update.',
            },
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'plan-update', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'update-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_register': {
          if (!authenticated) {
            return errorToolResult('Authentication required (zelidauth not set).');
          }

          const spec = asRecord(args.spec);
          const resourceUri = 'flux://resource/apps/register/full';
          const messageToSignResourceUri = 'flux://resource/apps/register/message';
          const summary = {
            ok: true,
            status: 'submitted',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            hash: 'reg-hash',
            payment: {
              address: 't1payment',
              amountFlux: 1.23,
              memo: 'reg-hash',
              note: 'Pay after optional test install.',
            },
            messageToSignSha256: 'register-sha',
            messageToSignBytes: 128,
            messageToSignResourceUri,
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
            nextActions: [{ tool: 'flux_apps_get_messages', arguments: { hash: 'reg-hash', kind: 'both' } }],
          };

          setTextResource(messageToSignResourceUri, 'REGISTER-MESSAGE');
          setJsonResource(resourceUri, {
            ...summary,
            payload: {
              signature: args.signature,
              timestamp: args.timestamp,
              typeVersion: args.typeVersion,
            },
            paymentSources: {
              deploymentInformation: createFluxRequestResult({ address: 't1payment' }),
              price: createFluxRequestResult({ flux: 1.23, currency: 'FLUX' }),
            },
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'register', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'register-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_update': {
          if (!authenticated) {
            return errorToolResult('Authentication required (zelidauth not set).');
          }

          const spec = asRecord(args.spec);
          const resourceUri = 'flux://resource/apps/update/full';
          const messageToSignResourceUri = 'flux://resource/apps/update/message';
          const summary = {
            ok: true,
            status: 'submitted',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            hash: 'upd-hash',
            payment: {
              address: 't1payment',
              amountFlux: 0.75,
              memo: 'upd-hash',
              note: 'Pay after propagation reaches permanent messages.',
            },
            messageToSignSha256: 'update-sha',
            messageToSignBytes: 144,
            messageToSignResourceUri,
            resourceUri,
            nextActions: [{ tool: 'flux_apps_get_messages', arguments: { hash: 'upd-hash', kind: 'both' } }],
          };

          setTextResource(messageToSignResourceUri, 'UPDATE-MESSAGE');
          setJsonResource(resourceUri, {
            ...summary,
            payload: {
              signature: args.signature,
              timestamp: args.timestamp,
              typeVersion: args.typeVersion,
            },
            paymentSources: {
              deploymentInformation: createFluxRequestResult({ address: 't1payment' }),
              price: createFluxRequestResult({ flux: 0.75, currency: 'FLUX' }),
            },
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for update.',
            },
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'update', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'update-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_register_and_verify': {
          if (args.confirm !== true) {
            return errorToolResult('confirm=true is required to run: apps/appregister');
          }
          if (!authenticated) {
            return errorToolResult('Authentication required (zelidauth not set).');
          }
          if (options?.registerVerifyThrowMessage) {
            throw new Error(options.registerVerifyThrowMessage);
          }

          const spec = asRecord(args.spec);
          const status = options?.registerVerifyStatus ?? 'awaiting_payment';
          const resourceUri = 'flux://resource/apps/register-and-verify/full';
          const messageToSignResourceUri = 'flux://resource/apps/register-and-verify/message';
          const summary = {
            ok: status !== 'error',
            status,
            done: status === 'verified',
            registered: status !== 'error',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            hash: 'reg-verify-hash',
            attemptsUsed: 2,
            temporaryPresent: status !== 'submitted',
            permanentPresent: status === 'verifying_global' || status === 'verified',
            globalPresent: status === 'verified' ? true : status === 'verifying_global' ? false : null,
            messageToSignSha256: 'register-verify-sha',
            messageToSignBytes: 128,
            messageToSignResourceUri,
            message: status === 'awaiting_payment'
              ? 'Registration broadcasted. Next: test install, then pay with memo=hash.'
              : status === 'verifying_global'
                ? 'Registration appears permanent, but global app spec not visible yet.'
                : status === 'verified'
                  ? 'Registration verified.'
                  : 'Registration submitted.',
            payment: {
              address: 't1payment',
              amountFlux: 1.23,
              memo: 'reg-verify-hash',
              note: 'Pay with memo=hash.',
            },
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
            nextActions: [{ tool: 'flux_apps_wait_for_propagation', arguments: { hash: 'reg-verify-hash', attempts: 5, intervalMs: 10 } }],
          };

          setTextResource(messageToSignResourceUri, 'REGISTER-VERIFY-MESSAGE');
          setJsonResource(resourceUri, summary);

          return {
            isError: status === 'error',
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'register-and-verify', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'register-verify-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_update_and_verify': {
          if (args.confirm !== true) {
            return errorToolResult('confirm=true is required to run: apps/appupdate');
          }
          if (!authenticated) {
            return errorToolResult('Authentication required (zelidauth not set).');
          }
          if (options?.updateVerifyThrowMessage) {
            throw new Error(options.updateVerifyThrowMessage);
          }

          const spec = asRecord(args.spec);
          const status = options?.updateVerifyStatus ?? 'verifying_global';
          const resourceUri = 'flux://resource/apps/update-and-verify/full';
          const messageToSignResourceUri = 'flux://resource/apps/update-and-verify/message';
          const summary = {
            ok: status !== 'error',
            status,
            done: status === 'verified',
            updated: status !== 'error',
            appname: String(spec.name ?? 'demo-app'),
            owner: String(spec.owner ?? 't1owner'),
            hash: 'upd-verify-hash',
            attemptsUsed: 3,
            temporaryPresent: true,
            permanentPresent: status === 'verifying_global' || status === 'verified',
            globalPresent: status === 'verified' ? true : status === 'verifying_global' ? false : null,
            messageToSignSha256: 'update-verify-sha',
            messageToSignBytes: 144,
            messageToSignResourceUri,
            message: status === 'pending'
              ? 'Update broadcasted. Wait for propagation to permanent messages.'
              : status === 'verifying_global'
                ? 'Update appears permanent, but global app spec not visible yet.'
                : status === 'verified'
                  ? 'Update verified.'
                  : 'Update submitted.',
            payment: {
              address: 't1payment',
              amountFlux: 0.75,
              memo: 'upd-verify-hash',
              note: 'Pay with memo=hash.',
            },
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for update.',
            },
            nextActions: [{ tool: 'flux_apps_wait_for_propagation', arguments: { hash: 'upd-verify-hash', attempts: 5, intervalMs: 10 } }],
          };

          setTextResource(messageToSignResourceUri, 'UPDATE-VERIFY-MESSAGE');
          setJsonResource(resourceUri, summary);

          return {
            isError: status === 'error',
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'update-and-verify', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'update-verify-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_apps_get_messages': {
          const hash = String(args.hash ?? 'pending-hash');
          const kind = String(args.kind ?? 'both');
          const entry = messageMatrix[hash] ?? { temporary: [], permanent: [] };
          const temporary = createFluxRequestResult(entry.temporary);
          const permanent = createFluxRequestResult(entry.permanent);

          if (kind === 'temporary') {
            const resourceUri = `flux://resource/apps/messages/temporary/${hash}`;
            setJsonResource(resourceUri, temporary);
            const summary = { ok: true, hash, kind, resourceUri, temporary: { ok: true, status: 200 } };
            return {
              isError: false,
              structuredContent: summary,
              content: [
                { type: 'text', text: JSON.stringify(summary, null, 2) },
                { type: 'resource_link', uri: resourceUri, name: `temporary-${hash}`, mimeType: 'application/json' },
              ],
            };
          }

          if (kind === 'permanent') {
            const resourceUri = `flux://resource/apps/messages/permanent/${hash}`;
            setJsonResource(resourceUri, permanent);
            const summary = { ok: true, hash, kind, resourceUri, permanent: { ok: true, status: 200 } };
            return {
              isError: false,
              structuredContent: summary,
              content: [
                { type: 'text', text: JSON.stringify(summary, null, 2) },
                { type: 'resource_link', uri: resourceUri, name: `permanent-${hash}`, mimeType: 'application/json' },
              ],
            };
          }

          const resourceUri = `flux://resource/apps/messages/both/${hash}`;
          setJsonResource(resourceUri, { temporary, permanent });
          const summary = {
            ok: true,
            hash,
            kind,
            resourceUri,
            temporary: { ok: true, status: 200 },
            permanent: { ok: true, status: 200 },
          };

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: `messages-${hash}`, mimeType: 'application/json' },
            ],
          };
        }

        case 'flux_apps_wait_for_propagation': {
          const hash = String(args.hash ?? 'pending-hash');
          const entry = messageMatrix[hash] ?? { temporary: [], permanent: [] };
          const temporaryPresent = Array.isArray(entry.temporary) ? entry.temporary.length > 0 : true;
          const permanentPresent = Array.isArray(entry.permanent) ? entry.permanent.length > 0 : true;
          const status = permanentPresent ? 'permanent' : temporaryPresent ? 'temporary' : 'pending';
          const resourceUri = `flux://resource/apps/propagation/${hash}`;
          const summary = {
            ok: true,
            hash,
            status,
            attemptsUsed: status === 'pending' ? 1 : 2,
            temporaryPresent,
            permanentPresent,
            resourceUri,
          };

          setJsonResource(resourceUri, {
            attemptsUsed: summary.attemptsUsed,
            temporaryPresent,
            permanentPresent,
            lastTemporary: createFluxRequestResult(entry.temporary),
            lastPermanent: createFluxRequestResult(entry.permanent),
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: `propagation-${hash}`, mimeType: 'application/json' },
            ],
          };
        }

        default:
          return errorToolResult(`Unknown tool: ${name}`);
      }
    },
    async readResource(uri) {
      const resource = resources.get(uri);
      if (!resource) return null;
      return { uri, mimeType: resource.mimeType, text: resource.text };
    },
  };

  return { runtime, calls };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-app-submit-'));
  const previousEnv = new Map<string, string | undefined>(MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;
  delete process.env.FLUX_API_BASE_URL;
  delete process.env.FLUX_ZELIDAUTH;
  delete process.env.FLUX_ENTERPRISE_KEY;
  delete process.env.FLUXDRIVE_MWS_BASE_URL;
  delete process.env.FLUX_HTTP_TIMEOUT_MS;
  delete process.env.FLUX_HTTP_RETRY_COUNT;
  delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  try {
    return await run(stateDir);
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(argv: string[], toolRuntime: ToolRuntime) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    toolRuntime,
    persistedStateMode: 'off',
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('apps submission and propagation workflows', () => {
  it('keeps planning usable without auth while register and update submissions stay gated', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsSubmissionRuntime({ authenticated: false });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      );
      expect(registrationPlan.exitCode).toBe(0);

      const updatePlan = await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      );
      expect(updatePlan.exitCode).toBe(0);

      const registrationPlanPayload = parseJson<Record<string, unknown>>(registrationPlan.stdout);
      const updatePlanPayload = parseJson<Record<string, unknown>>(updatePlan.stdout);

      const register = await invokeCli(
        ['apps', 'register', '--plan-resource-uri', String(registrationPlanPayload.resourceUri), '--signature', 'signed-register', '--json'],
        runtime,
      );
      expect(register.exitCode).toBe(3);
      expect(parseJson<Record<string, unknown>>(register.stdout)).toMatchObject({
        ok: false,
        status: 'auth_required',
      });

      const update = await invokeCli(
        ['apps', 'update', '--plan-resource-uri', String(updatePlanPayload.resourceUri), '--signature', 'signed-update', '--json'],
        runtime,
      );
      expect(update.exitCode).toBe(3);
      expect(parseJson<Record<string, unknown>>(update.stdout)).toMatchObject({
        ok: false,
        status: 'auth_required',
      });
    });
  });

  it('reuses plan artifacts for register and update submissions and preserves signed inputs', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsSubmissionRuntime({ authenticated: true });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      )).stdout);

      const updatePlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      )).stdout);

      const register = await invokeCli(
        ['apps', 'register', '--plan-resource-uri', String(registrationPlan.resourceUri), '--signature', 'signed-register', '--json'],
        runtime,
      );
      expect(register.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(register.stdout)).toMatchObject({
        ok: true,
        status: 'submitted',
        operation: 'register',
        appname: 'demo-app',
        owner: 't1owner',
        hash: 'reg-hash',
        timestamp: 111,
        typeVersion: 1,
        source: 'plan',
        planResourceUri: registrationPlan.resourceUri,
        payment: {
          memo: 'reg-hash',
        },
      });

      const update = await invokeCli(
        ['apps', 'update', '--plan-resource-uri', String(updatePlan.resourceUri), '--signature', 'signed-update', '--json'],
        runtime,
      );
      expect(update.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(update.stdout)).toMatchObject({
        ok: true,
        status: 'submitted',
        operation: 'update',
        appname: 'demo-app',
        owner: 't1owner',
        hash: 'upd-hash',
        timestamp: 222,
        typeVersion: 2,
        source: 'plan',
        planResourceUri: updatePlan.resourceUri,
        payment: {
          memo: 'upd-hash',
        },
      });

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'flux_apps_register',
            args: expect.objectContaining({
              signature: 'signed-register',
              timestamp: 111,
              typeVersion: 1,
              verifyFirst: false,
              spec: expect.objectContaining({
                name: 'demo-app',
                owner: 't1owner',
                verifiedFor: 'registration',
              }),
            }),
          }),
          expect.objectContaining({
            name: 'flux_apps_update',
            args: expect.objectContaining({
              signature: 'signed-update',
              timestamp: 222,
              typeVersion: 2,
              verifyFirst: false,
              spec: expect.objectContaining({
                name: 'demo-app',
                owner: 't1owner',
                verifiedFor: 'update',
              }),
            }),
          }),
        ]),
      );
    });
  });

  it('keeps confirm explicit for verify flows and exposes awaiting_payment and verifying_global statuses', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsSubmissionRuntime({
        authenticated: true,
        registerVerifyStatus: 'awaiting_payment',
        updateVerifyStatus: 'verifying_global',
      });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      )).stdout);

      const updatePlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      )).stdout);

      const missingConfirm = await invokeCli(
        ['apps', 'register-and-verify', '--plan-resource-uri', String(registrationPlan.resourceUri), '--signature', 'signed-register', '--json'],
        runtime,
      );
      expect(missingConfirm.exitCode).toBe(4);
      expect(parseJson<Record<string, unknown>>(missingConfirm.stdout)).toMatchObject({
        ok: false,
        status: 'confirm_required',
      });

      const registerAndVerify = await invokeCli(
        [
          'apps',
          'register-and-verify',
          '--plan-resource-uri',
          String(registrationPlan.resourceUri),
          '--signature',
          'signed-register',
          '--attempts',
          '5',
          '--interval-ms',
          '10',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(registerAndVerify.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(registerAndVerify.stdout)).toMatchObject({
        ok: true,
        status: 'awaiting_payment',
        operation: 'register-and-verify',
        appname: 'demo-app',
        hash: 'reg-verify-hash',
        temporaryPresent: true,
        permanentPresent: false,
        done: false,
      });

      const updateAndVerify = await invokeCli(
        [
          'apps',
          'update-and-verify',
          '--plan-resource-uri',
          String(updatePlan.resourceUri),
          '--signature',
          'signed-update',
          '--attempts',
          '5',
          '--interval-ms',
          '10',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(updateAndVerify.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(updateAndVerify.stdout)).toMatchObject({
        ok: true,
        status: 'verifying_global',
        operation: 'update-and-verify',
        appname: 'demo-app',
        hash: 'upd-verify-hash',
        temporaryPresent: true,
        permanentPresent: true,
        globalPresent: false,
        done: false,
      });

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'flux_apps_register_and_verify',
            args: expect.objectContaining({
              signature: 'signed-register',
              timestamp: 111,
              typeVersion: 1,
              confirm: true,
              attempts: 5,
              intervalMs: 10,
              verifyFirst: false,
            }),
          }),
          expect.objectContaining({
            name: 'flux_apps_update_and_verify',
            args: expect.objectContaining({
              signature: 'signed-update',
              timestamp: 222,
              typeVersion: 2,
              confirm: true,
              attempts: 5,
              intervalMs: 10,
              verifyFirst: false,
            }),
          }),
        ]),
      );
    });
  });

  it('still requires auth for verify flows after confirm is provided', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsSubmissionRuntime({ authenticated: false });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      )).stdout);

      const updatePlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      )).stdout);

      const registerAndVerify = await invokeCli(
        [
          'apps',
          'register-and-verify',
          '--plan-resource-uri',
          String(registrationPlan.resourceUri),
          '--signature',
          'signed-register',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(registerAndVerify.exitCode).toBe(3);
      expect(parseJson<Record<string, unknown>>(registerAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'auth_required',
        operation: 'register-and-verify',
        appname: 'demo-app',
      });

      const updateAndVerify = await invokeCli(
        [
          'apps',
          'update-and-verify',
          '--plan-resource-uri',
          String(updatePlan.resourceUri),
          '--signature',
          'signed-update',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(updateAndVerify.exitCode).toBe(3);
      expect(parseJson<Record<string, unknown>>(updateAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'auth_required',
        operation: 'update-and-verify',
        appname: 'demo-app',
      });

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'flux_apps_register_and_verify',
            args: expect.objectContaining({
              confirm: true,
              signature: 'signed-register',
              timestamp: 111,
              typeVersion: 1,
            }),
          }),
          expect.objectContaining({
            name: 'flux_apps_update_and_verify',
            args: expect.objectContaining({
              confirm: true,
              signature: 'signed-update',
              timestamp: 222,
              typeVersion: 2,
            }),
          }),
        ]),
      );
    });
  });

  it('preserves explicit error status for failed verify flows', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsSubmissionRuntime({
        authenticated: true,
        registerVerifyStatus: 'error',
        updateVerifyStatus: 'error',
      });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      )).stdout);

      const updatePlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      )).stdout);

      const registerAndVerify = await invokeCli(
        [
          'apps',
          'register-and-verify',
          '--plan-resource-uri',
          String(registrationPlan.resourceUri),
          '--signature',
          'signed-register',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(registerAndVerify.exitCode).toBe(6);
      expect(parseJson<Record<string, unknown>>(registerAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'register-and-verify',
        appname: 'demo-app',
      });

      const updateAndVerify = await invokeCli(
        [
          'apps',
          'update-and-verify',
          '--plan-resource-uri',
          String(updatePlan.resourceUri),
          '--signature',
          'signed-update',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(updateAndVerify.exitCode).toBe(6);
      expect(parseJson<Record<string, unknown>>(updateAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'update-and-verify',
        appname: 'demo-app',
      });
    });
  });

  it('preserves explicit error status when verify flows throw after submission planning succeeds', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsSubmissionRuntime({
        authenticated: true,
        registerVerifyThrowMessage: 'Could not extract message hash from registration response. Flux error: rejected',
        updateVerifyThrowMessage: 'Could not extract message hash from update response. Flux error: rejected',
      });
      const specJson = JSON.stringify({
        spec: { name: 'demo-app', owner: 't1owner', description: 'Demo app' },
      });

      const registrationPlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '111', '--type-version', '1', '--json'],
        runtime,
      )).stdout);

      const updatePlan = parseJson<Record<string, unknown>>((await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '222', '--type-version', '2', '--json'],
        runtime,
      )).stdout);

      const registerAndVerify = await invokeCli(
        [
          'apps',
          'register-and-verify',
          '--plan-resource-uri',
          String(registrationPlan.resourceUri),
          '--signature',
          'signed-register',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(registerAndVerify.exitCode).toBe(6);
      expect(parseJson<Record<string, unknown>>(registerAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'register-and-verify',
        appname: 'demo-app',
        planResourceUri: registrationPlan.resourceUri,
      });

      const updateAndVerify = await invokeCli(
        [
          'apps',
          'update-and-verify',
          '--plan-resource-uri',
          String(updatePlan.resourceUri),
          '--signature',
          'signed-update',
          '--confirm',
          '--json',
        ],
        runtime,
      );
      expect(updateAndVerify.exitCode).toBe(6);
      expect(parseJson<Record<string, unknown>>(updateAndVerify.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'update-and-verify',
        appname: 'demo-app',
        planResourceUri: updatePlan.resourceUri,
      });
    });
  });

  it('exposes explicit pending, temporary, and permanent statuses for messages and propagation waits', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsSubmissionRuntime({ authenticated: true });

      const pendingMessages = await invokeCli(['apps', 'messages', 'pending-hash', '--json'], runtime);
      expect(pendingMessages.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(pendingMessages.stdout)).toMatchObject({
        ok: true,
        status: 'pending',
        hash: 'pending-hash',
        kind: 'both',
        temporaryPresent: false,
        permanentPresent: false,
      });

      const temporaryMessages = await invokeCli(['apps', 'messages', 'temp-hash', '--json'], runtime);
      expect(temporaryMessages.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(temporaryMessages.stdout)).toMatchObject({
        ok: true,
        status: 'temporary',
        hash: 'temp-hash',
        temporaryPresent: true,
        permanentPresent: false,
        temporaryCount: 1,
        permanentCount: 0,
      });

      const permanentMessages = await invokeCli(['apps', 'messages', 'perm-hash', '--json'], runtime);
      expect(permanentMessages.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(permanentMessages.stdout)).toMatchObject({
        ok: true,
        status: 'permanent',
        hash: 'perm-hash',
        temporaryPresent: true,
        permanentPresent: true,
        temporaryCount: 1,
        permanentCount: 1,
      });

      const temporaryWait = await invokeCli(
        ['apps', 'wait-propagation', 'temp-hash', '--attempts', '5', '--interval-ms', '10', '--json'],
        runtime,
      );
      expect(temporaryWait.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(temporaryWait.stdout)).toMatchObject({
        ok: true,
        status: 'temporary',
        hash: 'temp-hash',
        attemptsUsed: 2,
        temporaryPresent: true,
        permanentPresent: false,
      });

      const permanentWait = await invokeCli(
        ['apps', 'wait-propagation', 'perm-hash', '--attempts', '5', '--interval-ms', '10', '--json'],
        runtime,
      );
      expect(permanentWait.exitCode).toBe(0);
      expect(parseJson<Record<string, unknown>>(permanentWait.stdout)).toMatchObject({
        ok: true,
        status: 'permanent',
        hash: 'perm-hash',
        attemptsUsed: 2,
        temporaryPresent: true,
        permanentPresent: true,
      });

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'flux_apps_get_messages', args: { hash: 'pending-hash', kind: 'both' } }),
          expect.objectContaining({ name: 'flux_apps_get_messages', args: { hash: 'temp-hash', kind: 'both' } }),
          expect.objectContaining({ name: 'flux_apps_get_messages', args: { hash: 'perm-hash', kind: 'both' } }),
          expect.objectContaining({ name: 'flux_apps_wait_for_propagation', args: { hash: 'temp-hash', attempts: 5, intervalMs: 10 } }),
          expect.objectContaining({ name: 'flux_apps_wait_for_propagation', args: { hash: 'perm-hash', attempts: 5, intervalMs: 10 } }),
        ]),
      );
    });
  });
});
