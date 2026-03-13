import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

function fluxRequestToolResult(data: unknown, status = 200) {
  const payload = createFluxRequestResult(data, status);
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function createAppsPlanningRuntime(): {
  runtime: ToolRuntime;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const resources = new Map<string, { text: string; mimeType: string }>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  const setTextResource = (uri: string, text: string) => {
    resources.set(uri, { text, mimeType: 'text/plain' });
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
        case 'flux_generate_app_spec_v8': {
          const spec = {
            version: 8,
            name: String(args.name),
            description: String(args.appDescription ?? ''),
            owner: String(args.owner),
            compose: [
              {
                name: String(args.componentName ?? 'web'),
                description: String(args.componentDescription ?? args.componentName ?? 'web'),
                repotag: String(args.repotag),
                ports: Array.isArray(args.ports) ? args.ports : [],
                domains: Array.isArray(args.domains) ? args.domains : [],
                environmentParameters: Array.isArray(args.environment) ? args.environment : [],
                commands: Array.isArray(args.commands) ? args.commands : [],
                containerPorts: Array.isArray(args.containerPorts) ? args.containerPorts : [],
                containerData: String(args.containerData ?? '/data'),
                cpu: Number(args.cpu ?? 1),
                ram: Number(args.ram ?? 2000),
                hdd: Number(args.hdd ?? 10),
                repoauth: '',
              },
            ],
            instances: Number(args.instances ?? 3),
            contacts: [],
            geolocation: [],
            expire: 22000,
            nodes: [],
            staticip: args.staticip === true,
            enterprise: String(args.enterprise ?? ''),
          };

          return {
            isError: false,
            structuredContent: { spec },
            content: [{ type: 'text', text: JSON.stringify({ spec }, null, 2) }],
          };
        }

        case 'flux_apps_verify_registration_spec': {
          const spec = asRecord(args.spec);
          return fluxRequestToolResult({ ...spec, verifiedFor: 'registration' });
        }

        case 'flux_apps_verify_update_spec': {
          const spec = asRecord(args.spec);
          return fluxRequestToolResult({ ...spec, verifiedFor: 'update' });
        }

        case 'flux_apps_calculate_price':
          return fluxRequestToolResult({ flux: 1.23, currency: 'FLUX' });

        case 'flux_apps_plan_registration': {
          const appname = asRecord(args.spec).name ?? 'demo-app';
          const owner = asRecord(args.spec).owner ?? 't1owner';
          const messageToSignResourceUri = 'flux://resource/apps/plan-registration/message';
          const resourceUri = 'flux://resource/apps/plan-registration/full';
          const summary = {
            ok: true,
            requiresAuth: true,
            authNote: 'Authenticate before submitting registration.',
            appname,
            owner,
            timestamp: Number(args.timestamp ?? 123),
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
            verified: createFluxRequestResult({ ...asRecord(args.spec), verifiedFor: 'registration' }),
            price: createFluxRequestResult({ flux: 1.23, currency: 'FLUX' }),
            registrationInformation: createFluxRequestResult({ blocksLasting: 100, daemonPONFork: 1 }),
            deploymentInformation: createFluxRequestResult({ address: 't1payment' }),
            payload: {
              type: 'fluxappregister',
              version: Number(args.typeVersion ?? 1),
              timestamp: Number(args.timestamp ?? 123),
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
          const appname = asRecord(args.spec).name ?? 'demo-app';
          const owner = asRecord(args.spec).owner ?? 't1owner';
          const messageToSignResourceUri = 'flux://resource/apps/plan-update/message';
          const resourceUri = 'flux://resource/apps/plan-update/full';
          const summary = {
            ok: true,
            requiresAuth: false,
            authNote: null,
            appname,
            owner,
            timestamp: Number(args.timestamp ?? 456),
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
            verified: createFluxRequestResult({ ...asRecord(args.spec), verifiedFor: 'update' }),
            price: createFluxRequestResult({ flux: 0.75, currency: 'FLUX' }),
            payload: {
              type: 'fluxappupdate',
              version: Number(args.typeVersion ?? 2),
              timestamp: Number(args.timestamp ?? 456),
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

        case 'flux_apps_plan_renew': {
          const resourceUri = 'flux://resource/apps/plan-renew/full';
          const summary = {
            ok: false,
            requiresAuth: true,
            appname: String(args.appname ?? 'enterprise-app'),
            ownerFilter: null,
            reference: {
              currentHeight: 150,
              blocksRemainingAtReference: 70,
              timeRemaining: '35m',
              blocksLasting: 100,
              daemonPONFork: 1,
            },
            policy: {
              mode: 'add_to_remaining',
              weeks: Number(args.weeks ?? 2),
              blocksPerWeek: 22000,
              blocksToAdd: 44000,
            },
            expireComputed: 44070,
            specSource: 'appspecifications',
            specWarning:
              'Enterprise app detected. appspecifications without decrypt omits compose/contacts; provide full spec or use enterprise decrypt flow before renewing.',
            isEnterprise: true,
            timestamp: 789,
            type: null,
            typeVersion: null,
            payment: null,
            messageToSignSha256: null,
            messageToSignBytes: null,
            messageToSignResourceUri: null,
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for update.',
            },
            next: 'Provide a full spec (especially for enterprise apps) to proceed with renewal.',
            nextActions: [
              {
                tool: 'flux_apps_get_spec_full',
                note: 'Fetch the decrypted spec first for enterprise renewals.',
              },
            ],
          };

          setJsonResource(resourceUri, {
            ...summary,
            updatedSpec: null,
            verified: null,
            price: null,
            payload: null,
          });

          return {
            isError: true,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'plan-renew', mimeType: 'application/json' },
            ],
          };
        }

        default:
          return {
            isError: true,
            structuredContent: { ok: false, error: `Unknown tool: ${name}` },
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
          };
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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-app-planning-'));
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

describe.sequential('apps planning, pricing, and spec generation', () => {
  it('generates a resource-backed spec artifact and reuses it for registration verification', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsPlanningRuntime();

      const generatedResult = await invokeCli(
        [
          'apps',
          'generate-spec',
          '--name',
          'demo-app',
          '--owner',
          't1owner',
          '--repotag',
          'repo/demo:1.0.0',
          '--app-description',
          'Demo app',
          '--component-name',
          'web',
          '--component-description',
          'Frontend',
          '--port',
          '80',
          '--container-port',
          '8080',
          '--domain',
          'demo.example.com',
          '--env',
          'NODE_ENV=production',
          '--command',
          'npm start',
          '--instances',
          '3',
          '--json',
        ],
        runtime
      );

      expect(generatedResult.exitCode).toBe(0);
      expect(generatedResult.stderr).toBe('');

      const generatedPayload = JSON.parse(generatedResult.stdout) as Record<string, unknown>;
      expect(generatedPayload).toMatchObject({
        ok: true,
        status: 'ok',
        appname: 'demo-app',
        owner: 't1owner',
        specVersion: 8,
        spec: {
          name: 'demo-app',
          owner: 't1owner',
          description: 'Demo app',
        },
      });
      expect(typeof generatedPayload.resourceUri).toBe('string');

      const verifyResult = await invokeCli(
        ['apps', 'verify-registration', '--spec-resource-uri', String(generatedPayload.resourceUri), '--json'],
        runtime
      );

      expect(verifyResult.exitCode).toBe(0);
      const verifyPayload = JSON.parse(verifyResult.stdout) as Record<string, unknown>;
      expect(verifyPayload).toMatchObject({
        ok: true,
        status: 'ok',
        validation: 'registration',
        appname: 'demo-app',
        owner: 't1owner',
        spec: {
          name: 'demo-app',
          verifiedFor: 'registration',
        },
      });
      expect(typeof verifyPayload.resourceUri).toBe('string');

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'flux_generate_app_spec_v8',
            args: expect.objectContaining({
              name: 'demo-app',
              owner: 't1owner',
              repotag: 'repo/demo:1.0.0',
            }),
          }),
          expect.objectContaining({
            name: 'flux_apps_verify_registration_spec',
            args: expect.objectContaining({
              spec: expect.objectContaining({
                name: 'demo-app',
                owner: 't1owner',
                description: 'Demo app',
              }),
            }),
          }),
        ])
      );
    });
  });

  it('accepts spec files for update verification and price calculation', async () => {
    await withTempStateDir(async (stateDir) => {
      const { runtime, calls } = createAppsPlanningRuntime();
      const specFile = join(stateDir, 'spec.json');
      await writeFile(
        specFile,
        JSON.stringify(
          {
            spec: {
              version: 8,
              name: 'demo-app',
              owner: 't1owner',
              description: 'Demo app',
            },
          },
          null,
          2
        ),
        'utf8'
      );

      const verifyResult = await invokeCli(['apps', 'verify-update', '--spec-file', specFile, '--json'], runtime);
      expect(verifyResult.exitCode).toBe(0);
      const verifyPayload = JSON.parse(verifyResult.stdout) as Record<string, unknown>;
      expect(verifyPayload).toMatchObject({
        ok: true,
        status: 'ok',
        validation: 'update',
        appname: 'demo-app',
        owner: 't1owner',
        spec: {
          verifiedFor: 'update',
        },
      });

      const priceResult = await invokeCli(['apps', 'calculate-price', '--spec-file', specFile, '--json'], runtime);
      expect(priceResult.exitCode).toBe(0);
      const pricePayload = JSON.parse(priceResult.stdout) as Record<string, unknown>;
      expect(pricePayload).toMatchObject({
        ok: true,
        status: 'ok',
        appname: 'demo-app',
        owner: 't1owner',
        fluxAmount: 1.23,
        price: {
          flux: 1.23,
          currency: 'FLUX',
        },
      });

      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'flux_apps_verify_update_spec',
            args: expect.objectContaining({
              spec: expect.objectContaining({ name: 'demo-app', owner: 't1owner' }),
            }),
          }),
          expect.objectContaining({
            name: 'flux_apps_calculate_price',
            args: expect.objectContaining({
              spec: expect.objectContaining({ name: 'demo-app', owner: 't1owner' }),
            }),
          }),
        ])
      );
    });
  });

  it('surfaces payment and message-to-sign metadata for registration and update planning', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsPlanningRuntime();
      const specJson = JSON.stringify({
        version: 8,
        name: 'demo-app',
        owner: 't1owner',
        description: 'Demo app',
      });

      const registrationPlanResult = await invokeCli(
        ['apps', 'plan-registration', '--spec-json', specJson, '--timestamp', '123', '--type-version', '1', '--json'],
        runtime
      );
      expect(registrationPlanResult.exitCode).toBe(0);
      const registrationPlanPayload = JSON.parse(registrationPlanResult.stdout) as Record<string, unknown>;
      expect(registrationPlanPayload).toMatchObject({
        ok: true,
        status: 'ok',
        appname: 'demo-app',
        owner: 't1owner',
        requiresAuth: true,
        payment: {
          address: 't1payment',
          amountFlux: 1.23,
        },
        price: {
          flux: 1.23,
          currency: 'FLUX',
        },
        verifiedSpec: {
          name: 'demo-app',
          verifiedFor: 'registration',
        },
        payload: {
          type: 'fluxappregister',
          version: 1,
          timestamp: 123,
        },
        messageToSignSha256: 'register-sha',
        messageToSignResourceUri: 'flux://resource/apps/plan-registration/message',
        resourceUri: 'flux://resource/apps/plan-registration/full',
      });

      const updatePlanResult = await invokeCli(
        ['apps', 'plan-update', '--spec-json', specJson, '--timestamp', '456', '--type-version', '2', '--json'],
        runtime
      );
      expect(updatePlanResult.exitCode).toBe(0);
      const updatePlanPayload = JSON.parse(updatePlanResult.stdout) as Record<string, unknown>;
      expect(updatePlanPayload).toMatchObject({
        ok: true,
        status: 'ok',
        appname: 'demo-app',
        owner: 't1owner',
        requiresAuth: false,
        payment: {
          address: 't1payment',
          amountFlux: 0.75,
        },
        price: {
          flux: 0.75,
          currency: 'FLUX',
        },
        verifiedSpec: {
          name: 'demo-app',
          verifiedFor: 'update',
        },
        payload: {
          type: 'fluxappupdate',
          version: 2,
          timestamp: 456,
        },
        messageToSignSha256: 'update-sha',
        messageToSignResourceUri: 'flux://resource/apps/plan-update/message',
        resourceUri: 'flux://resource/apps/plan-update/full',
      });
    });
  });

  it('returns explicit expiry calculations and enterprise caveats for incomplete renew planning', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsPlanningRuntime();

      const renewResult = await invokeCli(
        ['apps', 'plan-renew', 'enterprise-app', '--weeks', '2', '--json'],
        runtime
      );

      expect(renewResult.exitCode).toBe(6);
      expect(renewResult.stderr).toBe('');

      const renewPayload = JSON.parse(renewResult.stdout) as Record<string, unknown>;
      expect(renewPayload).toMatchObject({
        ok: false,
        status: 'planning_incomplete',
        appname: 'enterprise-app',
        reference: {
          currentHeight: 150,
          blocksRemainingAtReference: 70,
          timeRemaining: '35m',
        },
        policy: {
          mode: 'add_to_remaining',
          weeks: 2,
          blocksPerWeek: 22000,
          blocksToAdd: 44000,
        },
        expireComputed: 44070,
        specSource: 'appspecifications',
        isEnterprise: true,
        specWarning: expect.stringContaining('Enterprise app detected'),
        resourceUri: 'flux://resource/apps/plan-renew/full',
      });
      expect(Array.isArray(renewPayload.nextActions)).toBe(true);
    });
  });
});
