import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

function buildPlannedGitSpec(args: Record<string, unknown>) {
  const enterprise = args.enterprise === true || Boolean(args.repoToken);
  const baseSpec = {
    version: 8,
    name: String(args.name ?? 'git-demo'),
    owner: String(args.owner ?? 't1owner'),
    description: String(args.description ?? 'Git deploy app'),
    contacts: Array.isArray(args.contacts) ? args.contacts : [],
    instances: Number(args.instances ?? 3),
    staticip: args.staticip === true,
    enterprise: '',
    nodes: [],
    geolocation: Array.isArray(args.geolocation) ? args.geolocation : [],
    expire: Number(args.expireBlocks ?? 88000),
    compose: [
      {
        name: 'cloudgit',
        description: 'cloudgit',
        repotag: String(args.repotag ?? 'runonflux/orbit:latest'),
        ports: [Number(args.exposedPort ?? 20001), Number(args.managementPort ?? 20011)],
        containerPorts: [Number(args.appPort ?? 3000), 9001],
        domains: [String(args.domain ?? ''), ''],
        environmentParameters: [
          `GIT_REPO_URL=https://${String(args.repoUsername ?? 'git')}:${String(args.repoToken ?? 'token123')}@github.com/acme/private-repo`,
          `APP_PORT=${String(args.appPort ?? 3000)}`,
          `API_TOKEN=${String(args.repoToken ?? 'token123')}`,
          'WEBHOOK_SECRET=hook-secret',
        ],
        commands: [],
        containerData: '/app',
        cpu: Number(args.cpu ?? 1),
        ram: Number(args.ramMb ?? 2000),
        hdd: Number(args.hddGb ?? 10),
        tiered: false,
        repoauth: 'secret-auth',
      },
    ],
  };

  if (!enterprise) {
    return baseSpec;
  }

  return {
    ...baseSpec,
    contacts: [],
    compose: [],
    enterprise: 'encrypted-enterprise-payload',
  };
}

function createGitDeployRuntime(options?: { authenticated?: boolean }) {
  const resources = new Map<string, { text: string; mimeType: string }>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const authenticated = options?.authenticated === true;

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

      if ((name === 'flux_git_deploy_generate_spec_v8' || name === 'flux_git_deploy_plan_registration') && args.repoToken && args.confirm !== true) {
        return errorToolResult('confirm=true is required to run: git deploy: repoToken provided (sensitive)');
      }

      switch (name) {
        case 'flux_git_deploy_generate_spec_v8': {
          const resourceUri = 'flux://resource/git/spec';
          const spec = {
            version: 8,
            name: String(args.name),
            owner: String(args.owner),
            description: String(args.description ?? 'Git deploy app'),
            compose: [
              {
                name: 'cloudgit',
                repotag: String(args.repotag ?? 'runonflux/orbit:latest'),
                ports: [Number(args.exposedPort ?? 20001), Number(args.managementPort ?? 20011)],
                containerPorts: [Number(args.appPort ?? 3000), 9001],
                environmentParameters: Array.isArray(args.environment) ? args.environment : [],
                cpu: Number(args.cpu ?? 1),
              },
            ],
          };

          setJsonResource(resourceUri, spec);

          const summary = {
            ok: true,
            appname: String(args.name),
            owner: String(args.owner),
            repoUrl: String(args.repoUrl),
            branch: String(args.branch ?? 'main'),
            projectPath: String(args.projectPath ?? '/'),
            hasRepoToken: Boolean(args.repoToken),
            enterprise: args.enterprise === true,
            repotag: String(args.repotag ?? 'runonflux/orbit:latest'),
            appPort: Number(args.appPort ?? 3000),
            exposedPort: Number(args.exposedPort ?? 20001),
            managementPort: Number(args.managementPort ?? 20011),
            domain: String(args.domain ?? ''),
            instances: Number(args.instances ?? 3),
            cpu: Number(args.cpu ?? 1),
            ramMb: Number(args.ramMb ?? 2000),
            hddGb: Number(args.hddGb ?? 10),
            expireBlocks: Number(args.expireBlocks ?? 88000),
            envCount: Array.isArray(args.environment) ? args.environment.length : 0,
            geolocationCount: Array.isArray(args.geolocation) ? args.geolocation.length : 0,
            staticip: args.staticip === true,
            publicKeySource: 'provided',
            resourceUri,
            nextActions: [{ tool: 'flux_git_deploy_plan_registration', note: 'Plan registration using the generated spec.' }],
          };

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'git-spec', mimeType: 'application/json' },
            ],
          };
        }

        case 'flux_git_deploy_plan_registration': {
          const messageToSignResourceUri = 'flux://resource/git/plan/message';
          const resourceUri = 'flux://resource/git/plan/full';
          const rawSpec = buildPlannedGitSpec(args);
          const summary = {
            ok: true,
            requiresAuth: !authenticated,
            authNote: authenticated ? null : 'Authenticate before submitting registration.',
            appname: String(args.name),
            owner: String(args.owner),
            timestamp: Number(args.timestamp ?? 111),
            type: 'fluxappregister',
            typeVersion: Number(args.typeVersion ?? 1),
            git: {
              appname: String(args.name),
              owner: String(args.owner),
              hasRepoToken: Boolean(args.repoToken),
              repoUrl: String(args.repoUrl),
            },
            payment: {
              address: 't1payment',
              amountFlux: 1.23,
              memo: '<REGISTRATION_HASH>',
              note: 'Pay after registration returns a hash.',
            },
            messageToSignSha256: 'git-plan-sha',
            messageToSignBytes: 144,
            messageToSignResourceUri,
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
            nextActions: [{ tool: 'flux_git_deploy_register_and_verify', arguments: { planResourceUri: resourceUri, signature: '<SIGNATURE>', confirm: true } }],
          };

          setTextResource(messageToSignResourceUri, 'GIT-PLAN-MESSAGE');
          setJsonResource(resourceUri, {
            ...summary,
            spec: rawSpec,
            verified: createFluxRequestResult(rawSpec),
            price: createFluxRequestResult({ flux: 1.23, currency: 'FLUX' }),
            payload: {
              type: 'fluxappregister',
              version: Number(args.typeVersion ?? 1),
              timestamp: Number(args.timestamp ?? 111),
              appSpecification: rawSpec,
              signature: '<SIGNATURE>',
            },
          });

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'git-plan', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'git-plan-message', mimeType: 'text/plain' },
            ],
          };
        }

        case 'flux_git_deploy_register_and_verify': {
          if (args.confirm !== true) {
            return errorToolResult('confirm=true is required to run: git deploy: apps/appregister');
          }
          if (!authenticated) {
            return errorToolResult('Authentication required (zelidauth not set).');
          }

          const resourceUri = 'flux://resource/git/register/full';
          const messageToSignResourceUri = 'flux://resource/git/register/message';
          const summary = {
            ok: true,
            status: 'awaiting_payment',
            done: false,
            registered: true,
            git: {
              appname: 'git-private-app',
              owner: 't1owner',
              hasRepoToken: true,
              repoUrl: 'https://github.com/acme/private-repo',
            },
            appname: 'git-private-app',
            owner: 't1owner',
            hash: 'git-reg-hash',
            attemptsUsed: 1,
            temporaryPresent: true,
            permanentPresent: false,
            globalPresent: null,
            messageToSignSha256: 'git-submit-sha',
            messageToSignBytes: 144,
            messageToSignResourceUri,
            message: 'Registration broadcasted. Next: test install, then pay with memo=hash.',
            payment: {
              address: 't1payment',
              amountFlux: 1.23,
              memo: 'git-reg-hash',
              note: 'Pay to address with memo=hash.',
            },
            resourceUri,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
            nextActions: [{ tool: 'flux_apps_wait_for_propagation', arguments: { hash: 'git-reg-hash', attempts: 10, intervalMs: 3000 } }],
          };

          setTextResource(messageToSignResourceUri, 'GIT-SUBMIT-MESSAGE');
          setJsonResource(resourceUri, summary);

          return {
            isError: false,
            structuredContent: summary,
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', uri: resourceUri, name: 'git-register', mimeType: 'application/json' },
              { type: 'resource_link', uri: messageToSignResourceUri, name: 'git-register-message', mimeType: 'text/plain' },
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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-git-deploy-'));
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

async function invokeCli(argv: string[], toolRuntime?: ToolRuntime) {
  const capture = createCapture();
  const exitCode = await runCli(argv, toolRuntime ? { io: capture.io, toolRuntime } : { io: capture.io });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('git deploy workflows', () => {
  it('requires confirm before accepting a sensitive repo token', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createGitDeployRuntime();

      const result = await invokeCli([
        'git',
        'generate-spec',
        '--name', 'git-private-app',
        '--owner', 't1owner',
        '--repo-url', 'https://github.com/acme/private-repo',
        '--repo-token', 'token123',
        '--json',
      ], runtime);

      expect(result.exitCode).toBe(4);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('confirm_required');
      expect(result.stdout).not.toContain('token123');
    });
  });

  it('generates a usable git deploy spec and preserves parsed flags', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createGitDeployRuntime();

      const result = await invokeCli([
        'git',
        'generate-spec',
        '--name', 'git-spec-app',
        '--owner', 't1owner',
        '--repo-url', 'https://github.com/acme/repo',
        '--branch', 'develop',
        '--project-path', '/apps/web',
        '--repo-username', 'deploy-bot',
        '--contact', 'ops@example.com',
        '--contact', 'dev@example.com',
        '--app-port', '3030',
        '--exposed-port', '22001',
        '--management-port', '22011',
        '--instances', '2',
        '--cpu', '0.5',
        '--ram-mb', '4096',
        '--hdd-gb', '25',
        '--expire-blocks', '99000',
        '--geolocation', 'US-WEST',
        '--geolocation', 'EU-CENTRAL',
        '--env', 'NODE_ENV=production',
        '--env', 'LOG_LEVEL=debug',
        '--repotag', 'runonflux/orbit:stable',
        '--staticip',
        '--json',
      ], runtime);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = parseJson<Record<string, unknown>>(result.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.appname).toBe('git-spec-app');
      expect(payload.owner).toBe('t1owner');
      expect(payload.hasRepoToken).toBe(false);
      expect(payload.resourceUri).toBe('flux://resource/git/spec');

      const spec = asRecord(payload.spec);
      expect(spec.name).toBe('git-spec-app');
      expect(asRecord((spec.compose as unknown[])[0]).cpu).toBe(0.5);

      expect(calls[0]).toEqual({
        name: 'flux_git_deploy_generate_spec_v8',
        args: {
          name: 'git-spec-app',
          owner: 't1owner',
          repoUrl: 'https://github.com/acme/repo',
          branch: 'develop',
          projectPath: '/apps/web',
          repoUsername: 'deploy-bot',
          contacts: ['ops@example.com', 'dev@example.com'],
          appPort: 3030,
          exposedPort: 22001,
          managementPort: 22011,
          instances: 2,
          cpu: 0.5,
          ramMb: 4096,
          hddGb: 25,
          expireBlocks: 99000,
          geolocation: ['US-WEST', 'EU-CENTRAL'],
          environment: ['NODE_ENV=production', 'LOG_LEVEL=debug'],
          repotag: 'runonflux/orbit:stable',
          staticip: true,
        },
      });
    });
  });

  it('stores reusable git plans while redacting repo token material from stdout, resources, and state files', async () => {
    await withTempStateDir(async (stateDir) => {
      const { runtime } = createGitDeployRuntime({ authenticated: false });

      const result = await invokeCli([
        'git',
        'plan-registration',
        '--name', 'git-private-app',
        '--owner', 't1owner',
        '--repo-url', 'https://github.com/acme/private-repo',
        '--repo-username', 'git',
        '--repo-token', 'token123',
        '--enterprise',
        '--confirm',
        '--timestamp', '111',
        '--type-version', '1',
        '--json',
      ], runtime);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('token123');

      const payload = parseJson<Record<string, unknown>>(result.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.requiresAuth).toBe(true);
      expect(payload.resourceUri).toBe('flux://resource/git/plan/full');
      expect(payload.messageToSignResourceUri).toBe('flux://resource/git/plan/message');
      expect(payload.hasRepoToken).toBe(true);

      const verifiedSpec = asRecord(payload.verifiedSpec);
      expect(Array.isArray(verifiedSpec.compose)).toBe(true);
      expect((verifiedSpec.compose as unknown[]).length).toBe(0);
      expect(Array.isArray(verifiedSpec.contacts)).toBe(true);
      expect((verifiedSpec.contacts as unknown[]).length).toBe(0);
      expect(typeof verifiedSpec.enterprise).toBe('string');
      expect(String(verifiedSpec.enterprise)).not.toHaveLength(0);

      const resourceRead = await invokeCli(['resource', 'read', 'flux://resource/git/plan/full', '--json']);
      expect(resourceRead.exitCode).toBe(0);
      expect(resourceRead.stdout).not.toContain('token123');

      const storedPlan = parseJson<{ contents: { value: Record<string, unknown> } }>(resourceRead.stdout).contents.value;
      const storedSpec = asRecord(storedPlan.spec);
      expect(Array.isArray(storedSpec.compose)).toBe(true);
      expect((storedSpec.compose as unknown[]).length).toBe(0);
      expect(Array.isArray(storedSpec.contacts)).toBe(true);
      expect((storedSpec.contacts as unknown[]).length).toBe(0);
      expect(typeof storedSpec.enterprise).toBe('string');
      expect(String(storedSpec.enterprise)).not.toHaveLength(0);

      const storedPayload = asRecord(storedPlan.payload);
      const storedAppSpecification = asRecord(storedPayload.appSpecification);
      expect(Array.isArray(storedAppSpecification.compose)).toBe(true);
      expect((storedAppSpecification.compose as unknown[]).length).toBe(0);
      expect(Array.isArray(storedAppSpecification.contacts)).toBe(true);
      expect((storedAppSpecification.contacts as unknown[]).length).toBe(0);
      expect(typeof storedAppSpecification.enterprise).toBe('string');
      expect(String(storedAppSpecification.enterprise)).not.toHaveLength(0);

      const resourceStore = await readFile(join(stateDir, 'resources.json'), 'utf8');
      expect(resourceStore).not.toContain('token123');

      try {
        const stateStore = await readFile(join(stateDir, 'state.json'), 'utf8');
        expect(stateStore).not.toContain('token123');
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : null;
        expect(code).toBe('ENOENT');
      }
    });
  });

  it('registers a git deploy from a reusable plan artifact and preserves submission status fields', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createGitDeployRuntime({ authenticated: true });

      const planResult = await invokeCli([
        'git',
        'plan-registration',
        '--name', 'git-private-app',
        '--owner', 't1owner',
        '--repo-url', 'https://github.com/acme/private-repo',
        '--repo-username', 'git',
        '--repo-token', 'token123',
        '--enterprise',
        '--confirm',
        '--json',
      ], runtime);

      expect(planResult.exitCode).toBe(0);
      const planPayload = parseJson<Record<string, unknown>>(planResult.stdout);

      const submitResult = await invokeCli([
        'git',
        'register-and-verify',
        '--plan-resource-uri', String(planPayload.resourceUri),
        '--signature', 'sig-123',
        '--confirm',
        '--attempts', '5',
        '--interval-ms', '10',
        '--no-verify-global',
        '--no-poll',
        '--json',
      ], runtime);

      expect(submitResult.exitCode).toBe(0);
      expect(submitResult.stderr).toBe('');

      const payload = parseJson<Record<string, unknown>>(submitResult.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('awaiting_payment');
      expect(payload.planResourceUri).toBe('flux://resource/git/plan/full');
      expect(payload.hash).toBe('git-reg-hash');
      expect(payload.messageToSignResourceUri).toBe('flux://resource/git/register/message');
      expect(payload.hasRepoToken).toBe(true);
      expect(payload.resourceUri).toBe('flux://resource/git/register/full');

      expect(calls[1]).toEqual({
        name: 'flux_git_deploy_register_and_verify',
        args: {
          planResourceUri: 'flux://resource/git/plan/full',
          signature: 'sig-123',
          confirm: true,
          attempts: 5,
          intervalMs: 10,
          verifyGlobal: false,
          poll: false,
        },
      });
    });
  });
});
