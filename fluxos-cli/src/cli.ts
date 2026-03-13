import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  clearCliResources,
  listCliResources,
  persistCliResource,
  pruneCliResources,
  readCliResource,
  type ResourceClearResult,
  type ResourceDescriptor as CliResourceDescriptor,
  type ResourcePruneResult,
} from './state/resourceStore.js';
import {
  createPersistedProfile,
  clearPersistedEnterpriseKeyState,
  clearPersistedProfileState,
  deletePersistedProfile,
  getStateVisibilitySummary,
  listPersistedProfiles,
  loadPersistedStateSnapshot,
  type PersistedProfileState,
  type PersistedProfilesSummary,
  setPersistedProfileEnterpriseKey,
  setPersistedProfileZelidauth,
  summarizePersistedAuth,
  switchPersistedProfileBaseUrl,
  updatePersistedProfileState,
  usePersistedProfile,
} from './state/sessionState.js';

export type TextWriter = {
  write(chunk: string): void;
};

export type CliIo = {
  stdout: TextWriter;
  stderr: TextWriter;
};

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION = 2;
export const EXIT_CODE_AUTH = 3;
export const EXIT_CODE_CONFIRM = 4;
export const EXIT_CODE_NETWORK = 5;
export const EXIT_CODE_FLUX_FAILURE = 6;

type OutputMode = 'json' | 'pretty' | 'raw';

type FailureKind = 'validation' | 'auth' | 'confirm' | 'network' | 'flux';

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ToolContentItem = {
  type: string;
  text?: string;
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

type ToolCallResult = {
  content: ToolContentItem[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

export type ToolRuntime = {
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, rawArgs: unknown): Promise<ToolCallResult>;
  readResource?(uri: string): Promise<{ uri: string; mimeType?: string; text: string } | null>;
  hydrateResource?(resource: { uri: string; name: string; description?: string; mimeType?: string; text: string }): Promise<void>;
};

export type RunCliOptions = {
  io?: CliIo;
  toolRuntime?: ToolRuntime;
  persistedStateMode?: 'auto' | 'on' | 'off';
};

type ToolCatalogEntry = {
  name: string;
  description: string | null;
  inputSchema?: unknown;
};

type ToolCallEnvelope = {
  ok: boolean;
  status: string | number;
  tool: string;
  result: unknown;
  error?: string;
  resourceUri?: string;
  nextActions?: unknown[];
};

type ToolCallNormalization = {
  envelope: ToolCallEnvelope;
  failureKind?: FailureKind;
  rawResult: ToolCallResult;
};

type AppsDiscoveryParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsByZelidParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      zelid: string | null;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsGetSpecParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsGetSpecFullParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsGetOwnerParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsGetPublicKeyParseResult =
  | {
      outputMode: OutputMode;
      owner: string;
      name: string;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsTroubleshootParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsTestInstallParseResult =
  | {
      outputMode: OutputMode;
      hash: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsLifecycleParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsRedeployComponentParseResult =
  | {
      outputMode: OutputMode;
      appname: string;
      component: string;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsGenerateSpecParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsSpecInputSource = {
  kind: 'file' | 'json' | 'resource';
  value: string;
};

type AppsSpecInputParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      specSource: AppsSpecInputSource;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsSubmissionInputSource = AppsSpecInputSource | {
  kind: 'plan';
  value: string;
};

type AppsSubmissionParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      submissionSource: AppsSubmissionInputSource;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsHashParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      hash: string;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AppsPlanRenewParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      appname: string;
      specSource: AppsSpecInputSource | null;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

const HELP_TEXT = `FluxOS CLI

Usage:
  flux [command]

Commands:
  help                           Show this help output
  tool list [--json|--pretty|--raw]
                                 List callable Flux tools
  tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...]
                                 [--args-json '{...}'] [--args-file path.json]
                                 Execute a Flux tool through the shared runtime
  resource list [--json|--pretty]
                                 List persisted CLI resources
  resource read <uri> [--json|--pretty|--raw]
                                 Read a persisted CLI resource payload
  resource prune [--json|--pretty] [--clear-all]
                                 Prune expired/overflow resources or clear all
  state show [--json|--pretty]
                                 Show persisted CLI session state for the active profile
  state clear [--json|--pretty]
                                 Reset persisted CLI session state for the active profile
  profile list [--json|--pretty]
                                 List persisted CLI profiles and show which one is active
  profile create <name> [--json|--pretty]
                                 Create a persisted CLI profile
  profile use <name> [--json|--pretty]
                                 Switch to a persisted CLI profile
  profile delete <name> [--json|--pretty]
                                 Delete a persisted CLI profile
  auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>]
                                 Run phrase-first auth or verify and persist auth
  auth phrase [--use-emergency-phrase] [--zelid <zelid>]
                                 Fetch a login phrase without mutating persisted auth state
  auth status [--json|--pretty]
                                 Show current auth/base-url session status
  auth diagnose [--json|--pretty]
                                 Run non-mutating auth checks and next-step guidance
  auth logout [--json|--pretty]
                                 Remove persisted auth material for the active profile
  auth clear [--json|--pretty]
                                 Remove persisted auth material for the active profile
  apps list-running [--json|--pretty|--raw]
                                 List running apps on the active node
  apps list-all [--json|--pretty|--raw]
                                 List all apps known to the active node
  apps list-global [--owner <zelid>] [--appname <name>] [--hash <hash>] [--json|--pretty|--raw]
                                 List global app specs with optional owner/app/hash filters
  apps global-status [--zelid <zelid>] [--appname <name>] [--include-expired] [--limit <n>] [--json|--pretty|--raw]
                                 Correlate global registry rows with propagation signals
  apps troubleshoot <appname> [--deep] [--json|--pretty|--raw]
                                 Correlate registry, deployment, and runtime evidence for one app
  apps health [<appname>] [--appname <name>] [--logs-lines <n>] [--monitor-range-ms <ms>] [--json|--pretty|--raw]
                                 Return a compact runtime health summary with resource-backed observability details
  apps logs [<appname>] [--appname <name>] [--lines <count|all>] [--json|--pretty|--raw]
                                 Return a log summary and resource-backed full log payload
  apps inspect [<appname>] [--appname <name>] [--json|--pretty|--raw]
                                 Return an inspect summary and resource-backed raw inspect payload
  apps stats [<appname>] [--appname <name>] [--json|--pretty|--raw]
                                 Return resource-usage summaries and a resource-backed raw stats payload
  apps top [<appname>] [--appname <name>] [--json|--pretty|--raw]
                                 Return process-list summaries and a resource-backed raw top payload
  apps monitor [<appname>] [--appname <name>] [--range <ms>] [--json|--pretty|--raw]
                                 Return monitoring summaries and a resource-backed raw monitor payload
  apps exec [<appname>] [--appname <name>] --cmd <segment> [--cmd <segment> ...] [--env KEY=VALUE ...]
            [--confirm] [--json|--pretty|--raw]
                                 Execute a command inside an app container with explicit status output
  apps start [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
                                 Start an app with explicit confirmation
  apps stop [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
                                 Stop an app with explicit confirmation
  apps restart [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
                                 Restart an app with explicit confirmation
  apps redeploy [<appname>] [--appname <name>] [--force] [--global] [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]
                                 Redeploy an app and summarize parsed progress events
  apps redeploy-component [<appname>] [<component>] [--appname <name>] [--component <name>] [--force] [--timeout-ms <ms>]
                          [--confirm] [--json|--pretty|--raw]
                                 Redeploy one component and summarize parsed progress events
  apps generate-spec --name <name> --owner <zelid> --repotag <repo:tag> [--app-description <text>]
                     [--component-name <name>] [--component-description <text>] [--port <port> ...]
                     [--container-port <port> ...] [--domain <domain> ...] [--env KEY=VALUE ...]
                     [--command <command> ...] [--instances <n>] [--cpu <n>] [--ram <mb>] [--hdd <gb>]
                     [--container-data <path>] [--staticip] [--enterprise <value>] [--json|--pretty|--raw]
                                 Generate a v8 app spec and persist it as a reusable CLI artifact
  apps verify-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
                                 Verify a registration spec and return the canonicalized spec artifact
  apps verify-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
                                 Verify an update spec and return the canonicalized spec artifact
  apps calculate-price (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
                                 Calculate FLUX pricing for a spec artifact
  apps plan-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                         [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]
                                 Build registration planning metadata, payment guidance, and signing artifacts
  apps plan-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                   [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]
                                 Build update planning metadata, payment guidance, and signing artifacts
  apps register (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first]
                [--json|--pretty|--raw]
                                 Submit an app registration with explicit auth gating and status output
  apps update (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
              --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first]
              [--include-payment|--no-include-payment] [--json|--pretty|--raw]
                                 Submit an app update with explicit auth gating and status output
  apps register-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                           --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>]
                           [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first]
                           [--verify-global|--no-verify-global] [--poll|--no-poll] [--confirm] [--json|--pretty|--raw]
                                 Submit a registration and report explicit propagation/verification states
  apps update-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                         --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>]
                         [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first]
                         [--verify-global|--no-verify-global] [--poll|--no-poll]
                         [--include-payment|--no-include-payment] [--confirm] [--json|--pretty|--raw]
                                 Submit an update and report explicit propagation/verification states
  apps wait-propagation <hash> [--attempts <n>] [--interval-ms <ms>] [--timeout-ms <ms>] [--json|--pretty|--raw]
                                 Poll message propagation and report pending/temporary/permanent status
  apps messages <hash> [--kind temporary|permanent|both] [--json|--pretty|--raw]
                                 Read propagation messages and summarize pending/temporary/permanent state
  apps plan-renew <appname> [--owner <zelid>] [--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>]
                  [--weeks <n>] [--blocks-to-add <n>] [--mode <from_now|add_to_remaining>]
                  [--blocks-per-week <n>] [--seconds-per-block <n>] [--timestamp <ms>] [--type-version <n>]
                  [--json|--pretty|--raw]
                                 Plan an app renewal, including expiry calculations and enterprise caveats
  apps by-zelid [<zelid>] [--include-expired] [--estimate-time-remaining] [--seconds-per-block <n>] [--limit <n>]
                                 [--json|--pretty|--raw]
                                 List global apps for a ZelID with expiry metadata
  apps get-spec <appname> [--decrypt] [--json|--pretty|--raw]
                                 Read a base app spec and enterprise hints
  apps get-spec-full <appname> [--owner <zelid>] [--base-url <url> ...] [--timeout-ms <ms>]
                                 [--set-base-url-on-success|--no-set-base-url-on-success]
                                 [--include-secrets] [--confirm] [--json|--pretty|--raw]
                                 Read a full spec with enterprise safeguards
  apps get-owner <appname> [--json|--pretty|--raw]
                                 Read the owner for an app name
  apps get-public-key --owner <zelid> --name <appname> [--json|--pretty|--raw]
                                 Read the enterprise public key for an owner/app pair
  apps registration-information [--json|--pretty|--raw]
                                 Read app registration metadata
  apps deployment-information [--json|--pretty|--raw]
                                 Read app deployment metadata
  apps test-install <hash> [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]
                                 Test install a registration hash and derive semantic success from progress output
  node resolve-gateway [<gateway-base-url>] [--json|--pretty|--raw]
                                 Resolve a gateway to its recommended direct-node target
  node use-gateway [<gateway-base-url>] [--json|--pretty|--raw]
                                 Resolve and persist the recommended direct-node target
  node use-base-url <base-url> [--json|--pretty|--raw]
                                 Normalize and persist an explicit base URL
  enterprise-key clear [--json|--pretty]
                                 Remove the persisted enterprise key for the active profile

Options:
  -h, --help  Show this help output

Package:
  fluxos-cli (Node.js 20+ TypeScript ESM package)
`;

const TOOL_HELP_TEXT = `FluxOS CLI - tool

Usage:
  flux tool list [--json|--pretty|--raw]
  flux tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...]
  flux tool call <tool-name> [--json|--pretty|--raw] [--args-json '{...}']
  flux tool call <tool-name> [--json|--pretty|--raw] [--args-file path.json]

Notes:
  - Use one argument mode per invocation: repeated --arg, --args-json, or --args-file.
  - --json prints the normalized CLI envelope, --pretty prints a human summary,
    and --raw prints the raw tool payload without CLI wrapping.
`;

const RESOURCE_HELP_TEXT = `FluxOS CLI - resource

Usage:
  flux resource list [--json|--pretty]
  flux resource read <uri> [--json|--pretty|--raw]
  flux resource prune [--json|--pretty] [--clear-all]

Notes:
  - Resources are persisted on disk for reuse across fresh CLI invocations.
  - JSON resources are re-read as structured values in --json mode.
  - --clear-all removes all persisted CLI resources explicitly.
`;

const STATE_HELP_TEXT = `FluxOS CLI - state

Usage:
  flux state show [--json|--pretty]
  flux state clear [--json|--pretty]

Notes:
  - State is persisted per active CLI profile under the configured state directory.
  - JSON mode shows redacted auth and enterprise-key summaries only.
`;

const PROFILE_HELP_TEXT = `FluxOS CLI - profile

Usage:
  flux profile list [--json|--pretty]
  flux profile create <name> [--json|--pretty]
  flux profile use <name> [--json|--pretty]
  flux profile delete <name> [--json|--pretty]

Notes:
  - Profiles isolate saved base URL, auth, enterprise key, FluxDrive URL, and HTTP defaults.
  - The default profile always exists and cannot be deleted.
`;

const AUTH_HELP_TEXT = `FluxOS CLI - auth

Usage:
  flux auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>]
                  [--gateway-base-url <url>] [--force] [--use-emergency-phrase]
                  [--json|--pretty|--raw]
  flux auth phrase [--use-emergency-phrase] [--zelid <zelid>]
                    [--gateway-base-url <url>] [--json|--pretty|--raw]
  flux auth status [--json|--pretty|--raw]
  flux auth diagnose [--json|--pretty|--raw]
  flux auth logout [--json|--pretty]
  flux auth clear [--json|--pretty]

Notes:
  - \`login\` preserves the shared phrase-first auth semantics from flux-mcp.
  - \`phrase\` fetches a fresh normal or emergency login phrase without persisting auth state.
  - \`status\` is read-only and reports the hydrated session summary for the active profile.
  - \`diagnose\` reports concrete checks and next steps without mutating persisted state.
  - \`logout\` and \`clear\` clear only persisted auth material for the active profile.
  - Base URL, enterprise key, HTTP defaults, and FluxDrive settings stay unchanged.
`;

const NODE_HELP_TEXT = `FluxOS CLI - node

Usage:
  flux node resolve-gateway [<gateway-base-url>] [--json|--pretty|--raw]
  flux node use-gateway [<gateway-base-url>] [--json|--pretty|--raw]
  flux node use-base-url <base-url> [--json|--pretty|--raw]

Notes:
  - \`resolve-gateway\` is read-only and reports the recommended direct-node URL.
  - \`use-gateway\` resolves a gateway and persists the recommended direct-node base URL.
  - \`use-base-url\` normalizes explicit URLs and adopts matching cached credentials when available.
`;

const ENTERPRISE_KEY_HELP_TEXT = `FluxOS CLI - enterprise-key

Usage:
  flux enterprise-key clear [--json|--pretty]

Notes:
  - Clears only the persisted enterprise key for the active profile.
  - Base URL, auth, HTTP defaults, and FluxDrive settings stay unchanged.
`;

const APPS_HELP_TEXT = `FluxOS CLI - apps

Usage:
  flux apps list-running [--json|--pretty|--raw]
  flux apps list-all [--json|--pretty|--raw]
  flux apps list-global [--owner <zelid>] [--appname <name>] [--hash <hash>] [--json|--pretty|--raw]
  flux apps global-status [--zelid <zelid>] [--appname <name>] [--include-expired] [--limit <n>] [--json|--pretty|--raw]
  flux apps troubleshoot <appname> [--deep] [--json|--pretty|--raw]
  flux apps health [<appname>] [--appname <name>] [--logs-lines <n>] [--monitor-range-ms <ms>] [--json|--pretty|--raw]
  flux apps logs [<appname>] [--appname <name>] [--lines <count|all>] [--json|--pretty|--raw]
  flux apps inspect [<appname>] [--appname <name>] [--json|--pretty|--raw]
  flux apps stats [<appname>] [--appname <name>] [--json|--pretty|--raw]
  flux apps top [<appname>] [--appname <name>] [--json|--pretty|--raw]
  flux apps monitor [<appname>] [--appname <name>] [--range <ms>] [--json|--pretty|--raw]
  flux apps exec [<appname>] [--appname <name>] --cmd <segment> [--cmd <segment> ...] [--env KEY=VALUE ...]
                 [--confirm] [--json|--pretty|--raw]
  flux apps start [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
  flux apps stop [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
  flux apps restart [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]
  flux apps redeploy [<appname>] [--appname <name>] [--force] [--global] [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]
  flux apps redeploy-component [<appname>] [<component>] [--appname <name>] [--component <name>] [--force] [--timeout-ms <ms>]
                              [--confirm] [--json|--pretty|--raw]
  flux apps generate-spec --name <name> --owner <zelid> --repotag <repo:tag> [--app-description <text>]
                          [--component-name <name>] [--component-description <text>] [--port <port> ...]
                          [--container-port <port> ...] [--domain <domain> ...] [--env KEY=VALUE ...]
                          [--command <command> ...] [--instances <n>] [--cpu <n>] [--ram <mb>] [--hdd <gb>]
                          [--container-data <path>] [--staticip] [--enterprise <value>] [--json|--pretty|--raw]
  flux apps verify-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
  flux apps verify-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
  flux apps calculate-price (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]
  flux apps plan-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                              [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]
  flux apps plan-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                        [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]
  flux apps register (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                     --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first]
                     [--json|--pretty|--raw]
  flux apps update (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                   --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first]
                   [--include-payment|--no-include-payment] [--json|--pretty|--raw]
  flux apps register-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                                --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>]
                                [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first]
                                [--verify-global|--no-verify-global] [--poll|--no-poll] [--confirm] [--json|--pretty|--raw]
  flux apps update-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
                              --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>]
                              [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first]
                              [--verify-global|--no-verify-global] [--poll|--no-poll]
                              [--include-payment|--no-include-payment] [--confirm] [--json|--pretty|--raw]
  flux apps wait-propagation <hash> [--attempts <n>] [--interval-ms <ms>] [--timeout-ms <ms>] [--json|--pretty|--raw]
  flux apps messages <hash> [--kind temporary|permanent|both] [--json|--pretty|--raw]
  flux apps plan-renew <appname> [--owner <zelid>] [--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>]
                       [--weeks <n>] [--blocks-to-add <n>] [--mode <from_now|add_to_remaining>]
                       [--blocks-per-week <n>] [--seconds-per-block <n>] [--timestamp <ms>] [--type-version <n>]
                       [--json|--pretty|--raw]
  flux apps by-zelid [<zelid>] [--include-expired] [--estimate-time-remaining] [--seconds-per-block <n>] [--limit <n>]
                    [--json|--pretty|--raw]
  flux apps get-spec <appname> [--decrypt] [--json|--pretty|--raw]
  flux apps get-spec-full <appname> [--owner <zelid>] [--base-url <url> ...] [--timeout-ms <ms>]
                          [--set-base-url-on-success|--no-set-base-url-on-success]
                          [--include-secrets] [--confirm] [--json|--pretty|--raw]
  flux apps get-owner <appname> [--json|--pretty|--raw]
  flux apps get-public-key --owner <zelid> --name <appname> [--json|--pretty|--raw]
  flux apps registration-information [--json|--pretty|--raw]
  flux apps deployment-information [--json|--pretty|--raw]
  flux apps test-install <hash> [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]
  flux apps register (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
  flux apps update (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
  flux apps register-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
  flux apps update-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>)
  flux apps wait-propagation <hash> [--attempts <n>] [--interval-ms <ms>] [--timeout-ms <ms>] [--json|--pretty|--raw]
  flux apps messages <hash> [--kind temporary|permanent|both] [--json|--pretty|--raw]

Notes:
  - Discovery commands preserve the shared MCP selectors and defaulting behavior.
  - \`troubleshoot\` adds suspect classifications and suggested next actions on top of MCP summaries.
  - Runtime debug commands keep large payloads in resources and expose machine-friendly summaries.
  - Lifecycle mutations keep \`--confirm\` explicit and preserve relevant lifecycle flags.
  - \`redeploy\` and \`redeploy-component\` parse persisted progress output into semantic status summaries.
  - \`exec\` and \`test-install\` preserve explicit status fields instead of relying on HTTP status alone.
  - Deployment planning commands accept spec JSON, files, or prior CLI resource artifacts.
  - \`generate-spec\`, verification, pricing, and planning commands return stable metadata plus reusable artifacts.
  - Submission commands can reuse plan artifacts via \`--plan-resource-uri\` and keep auth/confirm gating explicit.
  - \`register-and-verify\`, \`update-and-verify\`, \`wait-propagation\`, and \`messages\` expose explicit workflow statuses.
  - \`plan-renew\` surfaces expiry calculations and enterprise caveats explicitly when a full renewable spec is unavailable.
  - \`by-zelid\` defaults to persisted auth ZelID when no explicit ZelID is provided.
  - \`get-spec\` reads the base spec and points enterprise apps to \`get-spec-full\`.
  - \`get-spec-full\` keeps enterprise inspection explicit; returning secrets requires
    \`--include-secrets --confirm\`.
`;

function writeLine(writer: TextWriter, text: string) {
  writer.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function renderHelp(): string {
  return HELP_TEXT;
}

function renderToolHelp(): string {
  return TOOL_HELP_TEXT;
}

function renderResourceHelp(): string {
  return RESOURCE_HELP_TEXT;
}

function renderStateHelp(): string {
  return STATE_HELP_TEXT;
}

function renderProfileHelp(): string {
  return PROFILE_HELP_TEXT;
}

function renderAuthHelp(): string {
  return AUTH_HELP_TEXT;
}

function renderNodeHelp(): string {
  return NODE_HELP_TEXT;
}

function renderEnterpriseKeyHelp(): string {
  return ENTERPRISE_KEY_HELP_TEXT;
}

function renderAppsHelp(): string {
  return APPS_HELP_TEXT;
}

function isHelpFlag(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isJsonLikeOutputMode(outputMode: OutputMode): boolean {
  return outputMode === 'json' || outputMode === 'raw';
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isJsonMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  return normalized === 'application/json' || normalized.endsWith('+json') || normalized.includes('/json');
}

function parseLooseValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${label}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function resolveOutputModePreference(requested: { json: boolean; pretty: boolean; raw: boolean }): OutputMode {
  if (requested.json) return 'json';
  if (requested.raw) return 'raw';
  return 'pretty';
}

function parseOutputMode(args: string[]): { outputMode: OutputMode; positional: string[] } | { outputMode: OutputMode; error: string } {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedCount = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);

  if (selectedCount > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  return { outputMode, positional };
}

async function parseToolArgs(
  args: string[]
): Promise<{ outputMode: OutputMode; rawArgs: Record<string, unknown>; positional: string[] } | { outputMode: OutputMode; error: string }> {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const keyValueArgs: string[] = [];
  let argsJson: string | undefined;
  let argsFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    if (arg === '--arg' || arg.startsWith('--arg=')) {
      const value = arg === '--arg' ? args[index + 1] : arg.slice('--arg='.length);
      if (arg === '--arg') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --arg. Expected key=value.' };
      }

      keyValueArgs.push(value);
      continue;
    }

    if (arg === '--args-json' || arg.startsWith('--args-json=')) {
      const value = arg === '--args-json' ? args[index + 1] : arg.slice('--args-json='.length);
      if (arg === '--args-json') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --args-json.' };
      }

      if (argsJson !== undefined) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Provide --args-json only once per invocation.' };
      }

      argsJson = value;
      continue;
    }

    if (arg === '--args-file' || arg.startsWith('--args-file=')) {
      const value = arg === '--args-file' ? args[index + 1] : arg.slice('--args-file='.length);
      if (arg === '--args-file') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --args-file.' };
      }

      if (argsFile !== undefined) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Provide --args-file only once per invocation.' };
      }

      argsFile = value;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  const selectedArgModes = Number(keyValueArgs.length > 0) + Number(argsJson !== undefined) + Number(argsFile !== undefined);
  if (selectedArgModes > 1) {
    return { outputMode, error: 'Choose only one argument mode: --arg, --args-json, or --args-file.' };
  }

  try {
    if (argsJson !== undefined) {
      return { outputMode, rawArgs: parseJsonObject(argsJson, '--args-json'), positional };
    }

    if (argsFile !== undefined) {
      let fileText: string;
      try {
        fileText = await readFile(argsFile, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outputMode, error: `Could not read --args-file ${argsFile}: ${message}` };
      }

      return { outputMode, rawArgs: parseJsonObject(fileText, `--args-file ${argsFile}`), positional };
    }

    const rawArgs: Record<string, unknown> = {};

    for (const pair of keyValueArgs) {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) {
        return { outputMode, error: `Invalid --arg value \`${pair}\`. Expected key=value.` };
      }

      const key = pair.slice(0, separatorIndex).trim();
      const rawValue = pair.slice(separatorIndex + 1);

      if (!key) {
        return { outputMode, error: `Invalid --arg value \`${pair}\`. Expected key=value.` };
      }

      rawArgs[key] = parseLooseValue(rawValue);
    }

    return { outputMode, rawArgs, positional };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outputMode, error: message };
  }
}

function renderJson(writer: TextWriter, value: unknown) {
  writeLine(writer, JSON.stringify(value, null, 2));
}

function isResourceLinkContent(item: ToolContentItem): item is ToolContentItem & {
  type: 'resource_link';
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
} {
  return item.type === 'resource_link' && typeof item.uri === 'string' && item.uri.length > 0;
}

function looksLikeFluxRequestResult(value: unknown): value is Record<string, unknown> & { ok: boolean; status: number | string; data: unknown } {
  const record = asRecord(value);
  if (!record) return false;

  return typeof record.ok === 'boolean' && (typeof record.status === 'number' || typeof record.status === 'string') && 'data' in record;
}

function extractFluxEnvelopeError(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const status = typeof record.status === 'string' ? record.status.toLowerCase() : undefined;
  if (!status || status === 'success') return undefined;

  const data = record.data;
  if (typeof data === 'string' && data.trim()) return data;

  const nested = asRecord(data);
  if (typeof nested?.message === 'string' && nested.message.trim()) return nested.message;

  return typeof record.status === 'string' ? record.status : undefined;
}

function stringifyFailureValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (!value || typeof value !== 'object') return undefined;

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function extractFailedCheckMessage(record: Record<string, unknown>): string | undefined {
  const checks = record.checks;
  if (!Array.isArray(checks)) return undefined;

  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (checkRecord?.ok !== false) continue;

    const checkName = typeof checkRecord.name === 'string' ? checkRecord.name.trim().toLowerCase() : '';
    const detailRecord = asRecord(checkRecord.detail);
    if (checkName === 'zelidauth' && detailRecord?.present === false) {
      return 'Authentication required (zelidauth not set).';
    }
  }

  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (checkRecord?.ok !== false) continue;

    const detailEnvelopeError = extractFluxEnvelopeError(checkRecord.detail);
    if (detailEnvelopeError) return detailEnvelopeError;

    const detail = stringifyFailureValue(checkRecord.detail);
    if (detail) return detail;

    if (typeof checkRecord.name === 'string' && checkRecord.name.trim()) {
      return `${checkRecord.name} check failed.`;
    }
  }

  return undefined;
}

function extractNestedFailureMessage(record: Record<string, unknown>): string | undefined {
  const failures = record.failures;
  if (!Array.isArray(failures)) return undefined;

  for (const failure of failures) {
    const failureRecord = asRecord(failure);
    if (!failureRecord) continue;

    const message = stringifyFailureValue(failureRecord.error) ?? stringifyFailureValue(failureRecord.message);
    if (message) return message;
  }

  return undefined;
}

function hasNegativeEnvelopeFailure(value: unknown): boolean {
  const record = asRecord(value);
  return record?.ok === false;
}

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;

  const record = asRecord(value);
  if (!record) return undefined;

  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;

  if (looksLikeFluxRequestResult(value)) {
    return extractFluxEnvelopeError(record.data) ?? (record.ok === false ? `Flux request failed with status ${String(record.status)}.` : undefined);
  }

  const detail = stringifyFailureValue(record.detail) ?? extractFailedCheckMessage(record) ?? extractNestedFailureMessage(record);
  if (detail) return detail;

  const envelopeError = extractFluxEnvelopeError(value);
  if (envelopeError) return envelopeError;

  if (record.ok === false) {
    return 'Flux tool execution failed.';
  }

  return undefined;
}

function hasFluxFailure(value: unknown): boolean {
  if (!looksLikeFluxRequestResult(value)) return false;

  if (value.ok === false) return true;
  return extractFluxEnvelopeError(value.data) !== undefined;
}

function classifyFailureKind(message: string): FailureKind {
  const lower = message.toLowerCase();

  if (
    lower.includes('authentication required') ||
    lower.includes('not authenticated') ||
    lower.includes('zelidauth not set') ||
    lower.includes('zelidauth is required') ||
    lower.includes('zelidauth required') ||
    lower.includes('requires zelidauth') ||
    lower.includes('requires authentication') ||
    lower.includes('auth required') ||
    lower.includes('unauthorized')
  ) {
    return 'auth';
  }

  if (lower.includes('confirm=true is required') || lower.includes('requires confirm=true') || lower.includes('confirm required')) {
    return 'confirm';
  }

  if (
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('econnrefused') ||
    lower.includes('connection refused') ||
    lower.includes('ehostunreach') ||
    lower.includes('host unreachable') ||
    lower.includes('enotfound') ||
    lower.includes('host not found') ||
    lower.includes('request failed after retries') ||
    lower.includes('econnreset') ||
    lower.includes('timed out')
  ) {
    return 'network';
  }

  if (
    lower.startsWith('unknown tool:') ||
    lower.includes(' must be ') ||
    lower.includes('must match') ||
    lower.includes('must start with') ||
    lower.includes('choose only one') ||
    lower.includes('unexpected arguments') ||
    lower.includes('invalid json') ||
    lower.includes('could not read --args-file') ||
    lower.includes('resource not found') ||
    lower.includes('base url not set') ||
    lower.includes('no baseurl available') ||
    lower.includes('did not contain valid json') ||
    lower.includes('json must be an object') ||
    lower.startsWith('usage:') ||
    lower.startsWith('invalid --arg value') ||
    lower.startsWith('missing value for --arg') ||
    lower.startsWith('missing value for --args-json') ||
    lower.startsWith('missing value for --args-file') ||
    lower.startsWith('provide --args-json only once') ||
    lower.startsWith('provide --args-file only once') ||
    lower.startsWith('unsupported ')
  ) {
    return 'validation';
  }

  return 'flux';
}

function failureStatus(kind: FailureKind): string {
  switch (kind) {
    case 'validation':
      return 'validation_error';
    case 'auth':
      return 'auth_required';
    case 'confirm':
      return 'confirm_required';
    case 'network':
      return 'network_error';
    case 'flux':
      return 'flux_error';
  }
}

function exitCodeForFailureKind(kind: FailureKind): number {
  switch (kind) {
    case 'validation':
      return EXIT_CODE_VALIDATION;
    case 'auth':
      return EXIT_CODE_AUTH;
    case 'confirm':
      return EXIT_CODE_CONFIRM;
    case 'network':
      return EXIT_CODE_NETWORK;
    case 'flux':
      return EXIT_CODE_FLUX_FAILURE;
  }
}

function buildFailurePayload(kind: FailureKind, message: string, tool?: string) {
  return {
    ok: false,
    status: failureStatus(kind),
    ...(tool ? { tool } : {}),
    error: message,
  };
}

function normalizeToolCatalogEntry(tool: ToolDefinition): ToolCatalogEntry {
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : null,
    inputSchema: tool.inputSchema,
  };
}

function renderToolCatalogPretty(tools: ToolCatalogEntry[]): string {
  if (tools.length === 0) {
    return 'Flux tool catalog is empty.';
  }

  return [
    `Flux tool catalog (${tools.length})`,
    ...tools.map((tool) => `- ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`),
  ].join('\n');
}

function readFirstTextContent(content: ToolContentItem[]): unknown {
  const firstText = content.find((item) => item.type === 'text' && typeof item.text === 'string');
  if (!firstText || typeof firstText.text !== 'string') return undefined;
  return parseJsonText(firstText.text);
}

function extractResourceUri(content: ToolContentItem[], result: unknown): string | undefined {
  const record = asRecord(result);
  const fromResult = record?.resourceUri;
  if (typeof fromResult === 'string' && fromResult.length > 0) return fromResult;

  const link = content.find((item) => item.type === 'resource_link' && typeof item.uri === 'string');
  return typeof link?.uri === 'string' && link.uri.length > 0 ? link.uri : undefined;
}

function extractNextActions(result: unknown): unknown[] | undefined {
  const value = asRecord(result)?.nextActions;
  return Array.isArray(value) ? value : undefined;
}

function deriveSuccessStatus(result: unknown): string | number {
  const record = asRecord(result);

  if (!looksLikeFluxRequestResult(result) && (typeof record?.status === 'string' || typeof record?.status === 'number')) {
    return record.status;
  }

  if (looksLikeFluxRequestResult(result)) {
    const requestRecord = result as Record<string, unknown>;
    const nestedStatus = asRecord(requestRecord.data)?.status;
    if (typeof nestedStatus === 'string' || typeof nestedStatus === 'number') return nestedStatus;
  }

  return 'ok';
}

function normalizeToolCall(toolName: string, toolResult: ToolCallResult): ToolCallNormalization {
  const result = toolResult.structuredContent ?? readFirstTextContent(toolResult.content) ?? null;
  const explicitFailure = toolResult.isError === true || hasNegativeEnvelopeFailure(result) || hasFluxFailure(result);
  const error = explicitFailure ? extractErrorMessage(result) ?? 'Flux tool execution failed.' : undefined;
  const failureKind = explicitFailure && error ? classifyFailureKind(error) : undefined;
  const ok = failureKind === undefined;
  const status = ok ? deriveSuccessStatus(result) : failureStatus(failureKind ?? 'flux');
  const resourceUri = extractResourceUri(toolResult.content, result);
  const nextActions = extractNextActions(result);

  return {
    envelope: {
      ok,
      status,
      tool: toolName,
      result,
      ...(error ? { error } : {}),
      ...(resourceUri ? { resourceUri } : {}),
      ...(nextActions ? { nextActions } : {}),
    },
    ...(failureKind ? { failureKind } : {}),
    rawResult: toolResult,
  };
}

function renderToolCallPretty(envelope: ToolCallEnvelope): string {
  const lines = [`Tool: ${envelope.tool}`, `Status: ${String(envelope.status)}`, `OK: ${String(envelope.ok)}`];

  if (envelope.error) {
    lines.push(`Error: ${envelope.error}`);
  }

  if (envelope.resourceUri) {
    lines.push(`Resource URI: ${envelope.resourceUri}`);
  }

  if (envelope.nextActions && envelope.nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of envelope.nextActions) {
      lines.push(`- ${JSON.stringify(action)}`);
    }
  }

  lines.push('Result:');
  lines.push(typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result, null, 2));

  return lines.join('\n');
}

function emitFailure(kind: FailureKind, message: string, io: CliIo, outputMode: OutputMode, tool?: string): number {
  if (isJsonLikeOutputMode(outputMode)) {
    renderJson(io.stdout, buildFailurePayload(kind, message, tool));
  } else {
    writeLine(io.stderr, message);
  }

  return exitCodeForFailureKind(kind);
}

async function getDefaultToolRuntime(): Promise<ToolRuntime> {
  const module = (await import('./runtime/toolRuntime.js')) as { createDefaultToolRuntime(): ToolRuntime };
  return module.createDefaultToolRuntime();
}

function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }

  return url.replace(/\/+$/, '');
}

async function executeToolCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<ToolCallNormalization> {
  await hydratePersistedSessionState(toolRuntime, mode);
  await hydratePersistedResourceArguments(rawArgs, toolRuntime);

  const rawResult = await toolRuntime.callTool(toolName, rawArgs);
  await persistMutatedSessionState(toolName, rawArgs, rawResult, mode);
  await persistToolResources(rawResult, toolRuntime);

  return normalizeToolCall(toolName, rawResult);
}

function shouldPersistState(mode: RunCliOptions['persistedStateMode']): boolean {
  return mode !== 'off';
}

async function hydratePersistedSessionState(toolRuntime: ToolRuntime, mode: RunCliOptions['persistedStateMode']): Promise<void> {
  if (!shouldPersistState(mode)) return;

  const snapshot = await loadPersistedStateSnapshot();
  const profile = snapshot.profile;

  await toolRuntime.callTool('flux_clear_zelidauth', {});
  await toolRuntime.callTool('flux_clear_enterprise_key', {});

  if (profile.baseUrl) {
    await toolRuntime.callTool('flux_set_base_url', { baseUrl: profile.baseUrl });
  }

  await toolRuntime.callTool('flux_set_http_defaults', profile.httpDefaults);
  await toolRuntime.callTool('flux_fluxdrive_set_base_url', { baseUrl: profile.fluxDriveMwsBaseUrl });

  if (profile.zelidauth) {
    let value: unknown = profile.zelidauth;
    try {
      value = JSON.parse(profile.zelidauth);
    } catch {
      value = profile.zelidauth;
    }

    await toolRuntime.callTool('flux_set_zelidauth', { zelidauth: value });
  }

  if (profile.enterpriseKey) {
    await toolRuntime.callTool('flux_set_enterprise_key', { enterpriseKey: profile.enterpriseKey });
  }
}

async function persistMutatedSessionState(
  toolName: string,
  rawArgs: Record<string, unknown>,
  rawResult: ToolCallResult,
  mode: RunCliOptions['persistedStateMode']
): Promise<void> {
  if (!shouldPersistState(mode)) return;

  const normalized = normalizeToolCall(toolName, rawResult);
  if (!normalized.envelope.ok) return;

  switch (toolName) {
    case 'flux_set_base_url': {
      const baseUrl = typeof rawArgs.baseUrl === 'string' ? rawArgs.baseUrl.trim() : '';
      if (!baseUrl) return;

      await updatePersistedProfileState((current) => switchPersistedProfileBaseUrl(current, baseUrl));
      return;
    }

    case 'flux_set_base_url_from_gateway': {
      const result = asRecord(normalized.envelope.result);
      const baseUrl = typeof result?.baseUrl === 'string' ? result.baseUrl.trim() : '';
      if (!baseUrl) return;

      await updatePersistedProfileState((current) => switchPersistedProfileBaseUrl(current, baseUrl));
      return;
    }

    case 'flux_set_http_defaults': {
      await updatePersistedProfileState((current) => ({
        ...current,
        httpDefaults: {
          timeoutMs: typeof rawArgs.timeoutMs === 'number' ? rawArgs.timeoutMs : current.httpDefaults.timeoutMs,
          retryCount: typeof rawArgs.retryCount === 'number' ? rawArgs.retryCount : current.httpDefaults.retryCount,
          retryBackoffMs:
            typeof rawArgs.retryBackoffMs === 'number' ? rawArgs.retryBackoffMs : current.httpDefaults.retryBackoffMs,
        },
      }));
      return;
    }

    case 'flux_set_zelidauth': {
      const rawValue = rawArgs.zelidauth;
      if (typeof rawValue !== 'string' && (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue))) return;
      const serialized = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);

      await updatePersistedProfileState((current) => setPersistedProfileZelidauth(current, serialized));
      return;
    }

    case 'flux_clear_zelidauth': {
      await updatePersistedProfileState((current) => setPersistedProfileZelidauth(current, null));
      return;
    }

    case 'flux_auth_login': {
      const result = asRecord(normalized.envelope.result);
      if (!result || result.needSignature === true) return;

      const zelidauthSet = result.zelidauthSet === true;
      const alreadyAuthenticated = result.alreadyAuthenticated === true;
      if (!zelidauthSet && !alreadyAuthenticated) return;

      const baseUrl = typeof result.baseUrl === 'string' && result.baseUrl.trim() ? normalizeBaseUrl(result.baseUrl) : null;
      const zelid = typeof rawArgs.zelid === 'string' ? rawArgs.zelid.trim() : '';
      const signature = typeof rawArgs.signature === 'string' ? rawArgs.signature.trim() : '';
      const loginPhrase = typeof rawArgs.loginPhrase === 'string' ? rawArgs.loginPhrase.trim() : '';

      await updatePersistedProfileState((current) => {
        const next = baseUrl ? switchPersistedProfileBaseUrl(current, baseUrl) : current;

        return zelidauthSet && zelid && signature && loginPhrase
          ? setPersistedProfileZelidauth(next, JSON.stringify({ zelid, signature, loginPhrase }))
          : next;
      });
      return;
    }

    case 'flux_set_enterprise_key': {
      const enterpriseKey = typeof rawArgs.enterpriseKey === 'string' ? rawArgs.enterpriseKey.trim() : '';
      if (!enterpriseKey) return;

      await updatePersistedProfileState((current) => setPersistedProfileEnterpriseKey(current, enterpriseKey));
      return;
    }

    case 'flux_clear_enterprise_key': {
      await updatePersistedProfileState((current) => setPersistedProfileEnterpriseKey(current, null));
      return;
    }

    case 'flux_fluxdrive_set_base_url': {
      const baseUrl = typeof rawArgs.baseUrl === 'string' ? rawArgs.baseUrl.trim() : '';
      if (!baseUrl) return;

      await updatePersistedProfileState((current) => ({
        ...current,
        fluxDriveMwsBaseUrl: normalizeBaseUrl(baseUrl),
      }));
      return;
    }
  }
}

async function hydratePersistedResourceArguments(rawArgs: Record<string, unknown>, toolRuntime: ToolRuntime): Promise<void> {
  if (typeof toolRuntime.hydrateResource !== 'function') return;

  const hydratedUris = new Set<string>();

  for (const [key, value] of Object.entries(rawArgs)) {
    if (!key.toLowerCase().endsWith('resourceuri') || typeof value !== 'string' || hydratedUris.has(value)) continue;

    const persisted = await readCliResource(value);
    if (!persisted) continue;

    hydratedUris.add(value);
    await toolRuntime.hydrateResource({
      uri: persisted.uri,
      name: persisted.name,
      description: persisted.description,
      mimeType: persisted.mimeType,
      text: persisted.text,
    });
  }
}

async function persistToolResources(rawResult: ToolCallResult, toolRuntime: ToolRuntime): Promise<void> {
  if (typeof toolRuntime.readResource !== 'function') return;

  const resourceLinks = rawResult.content.filter(isResourceLinkContent);
  for (const link of resourceLinks) {
    const contents = await toolRuntime.readResource(link.uri);
    if (!contents) continue;

    await persistCliResource({
      descriptor: {
        uri: link.uri,
        name: link.name ?? link.uri,
        description: link.description,
        mimeType: link.mimeType,
      },
      contents,
    });
  }
}

async function handleToolList(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux tool list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const tools = (await toolRuntime.listTools()).map(normalizeToolCatalogEntry).sort((left, right) => left.name.localeCompare(right.name));
  const payload = {
    ok: true,
    status: 'ok',
    count: tools.length,
    tools,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderToolCatalogPretty(tools));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleToolCall(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const [toolName, ...rest] = args;

  if (!toolName || toolName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    const outputMode = parsed.outputMode;
    return emitFailure(
      'validation',
      'Usage: flux tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...|--args-json {...}|--args-file path.json]',
      io,
      outputMode
    );
  }

  const parsed = await parseToolArgs(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode, toolName);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux tool call\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode, toolName);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(toolName, parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode, toolName);
  }

  const exitCode = normalized.failureKind ? exitCodeForFailureKind(normalized.failureKind) : EXIT_CODE_SUCCESS;

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, normalized.envelope);
    return exitCode;
  }

  if (parsed.outputMode === 'raw') {
    renderJson(io.stdout, normalized.rawResult);
    return exitCode;
  }

  const writer = normalized.envelope.ok ? io.stdout : io.stderr;
  writeLine(writer, renderToolCallPretty(normalized.envelope));
  return exitCode;
}

function renderResourceListPretty(resources: Array<CliResourceDescriptor & { createdAtMs: number; expiresAtMs: number; sizeBytes: number }>): string {
  if (resources.length === 0) return 'No persisted CLI resources.';

  return [
    `Persisted CLI resources (${resources.length})`,
    ...resources.map((resource) => {
      const extras = [resource.mimeType ?? 'text/plain', `${resource.sizeBytes} bytes`].join(' · ');
      return `- ${resource.uri} — ${resource.name} (${extras})`;
    }),
  ].join('\n');
}

function parseStoredResourceValue(text: string, mimeType?: string): unknown {
  if (!isJsonMimeType(mimeType)) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function handleResourceList(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const resources = await listCliResources();
  const payload = {
    ok: true,
    status: 'ok',
    count: resources.length,
    resources: resources.map((resource) => ({
      ...resource,
      persistent: true,
    })),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderResourceListPretty(resources));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleResourceRead(args: string[], io: CliIo): Promise<number> {
  const [uri, ...rest] = args;
  if (!uri || uri.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux resource read <uri> [--json|--pretty|--raw]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource read\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const resource = await readCliResource(uri);
  if (!resource) {
    return emitFailure('validation', `Resource not found: ${uri}`, io, parsed.outputMode);
  }

  const value = parseStoredResourceValue(resource.text, resource.mimeType);
  const payload = {
    ok: true,
    status: 'ok',
    resource: {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType ?? 'text/plain',
      createdAtMs: resource.createdAtMs,
      expiresAtMs: resource.expiresAtMs,
      sizeBytes: resource.sizeBytes,
      persistent: true,
    },
    contents: {
      text: resource.text,
      ...(isJsonMimeType(resource.mimeType) ? { value } : {}),
    },
  };

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, payload);
    return EXIT_CODE_SUCCESS;
  }

  if (parsed.outputMode === 'raw') {
    io.stdout.write(resource.text);
    return EXIT_CODE_SUCCESS;
  }

  const prettyLines = [
    `Resource: ${resource.uri}`,
    `Name: ${resource.name}`,
    `MIME type: ${resource.mimeType ?? 'text/plain'}`,
    'Contents:',
    resource.text,
  ];
  writeLine(io.stdout, prettyLines.join('\n'));
  return EXIT_CODE_SUCCESS;
}

async function handleResourcePrune(args: string[], io: CliIo): Promise<number> {
  let clearAll = false;
  const filteredArgs: string[] = [];

  for (const arg of args) {
    if (arg === '--clear-all') {
      clearAll = true;
      continue;
    }

    filteredArgs.push(arg);
  }

  const parsed = parseOutputMode(filteredArgs);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource prune\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const payload:
    | ({ ok: true; status: 'ok'; action: 'clearAll' } & ResourceClearResult)
    | ({ ok: true; status: 'ok'; action: 'prune' } & ResourcePruneResult) = clearAll
    ? { ok: true, status: 'ok', action: 'clearAll', ...(await clearCliResources()) }
    : { ok: true, status: 'ok', action: 'prune', ...(await pruneCliResources()) };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    if (payload.action === 'clearAll') {
      writeLine(io.stdout, `Cleared ${payload.before} persisted CLI resources.`);
    } else {
      writeLine(
        io.stdout,
        `Pruned persisted CLI resources: before=${payload.before}, after=${payload.after}, expired=${payload.removedExpired}, overflow=${payload.removedOverflow}`
      );
    }
  }

  return EXIT_CODE_SUCCESS;
}

async function handleResourceCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderResourceHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return handleResourceList(rest, io);
    case 'read':
      return handleResourceRead(rest, io);
    case 'prune':
      return handleResourcePrune(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown resource subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

function renderStatePretty(state: Awaited<ReturnType<typeof getStateVisibilitySummary>>): string {
  return [
    `Active profile: ${state.activeProfile}`,
    `Base URL: ${state.baseUrl ?? '<unset>'}`,
    `Auth: ${state.auth.present ? `present${state.auth.zelid ? ` (zelid: ${state.auth.zelid})` : ''}` : 'not set'}`,
    `Enterprise key: ${state.enterpriseKey.present ? 'present' : 'not set'}`,
    `FluxDrive base URL: ${state.fluxDriveMwsBaseUrl}`,
    `HTTP defaults: timeoutMs=${state.httpDefaults.timeoutMs}, retryCount=${state.httpDefaults.retryCount}, retryBackoffMs=${state.httpDefaults.retryBackoffMs}`,
    `State dir: ${state.paths.stateDir}`,
    `State file: ${state.paths.stateFile}`,
    `Resource store file: ${state.paths.resourceStoreFile}`,
  ].join('\n');
}

async function handleStateShow(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux state show\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderStatePretty(state));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleStateClear(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux state clear\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  await clearPersistedProfileState();
  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action: 'clear',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `Cleared persisted state for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

type AuthLoginParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type AuthPhraseParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

function readFlagValue(
  args: string[],
  index: number,
  arg: string,
  flagName: string
): { value: string; nextIndex: number } | { error: string } {
  if (arg === flagName) {
    const value = args[index + 1];
    if (!value) {
      return { error: `Missing value for ${flagName}.` };
    }

    return { value, nextIndex: index + 1 };
  }

  const prefix = `${flagName}=`;
  const value = arg.slice(prefix.length);
  if (!value) {
    return { error: `Missing value for ${flagName}.` };
  }

  return { value, nextIndex: index };
}

function readIntegerFlagValue(
  args: string[],
  index: number,
  arg: string,
  flagName: string,
  opts?: { min?: number }
): { value: number; nextIndex: number } | { error: string } {
  const raw = readFlagValue(args, index, arg, flagName);
  if ('error' in raw) return raw;

  const value = Number(raw.value);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { error: `${flagName} must be an integer.` };
  }

  if (typeof opts?.min === 'number' && value < opts.min) {
    return { error: `${flagName} must be >= ${opts.min}.` };
  }

  return { value, nextIndex: raw.nextIndex };
}

function parseAppsFlagArgs(
  args: string[],
  config: {
    stringFlags?: Array<{ flag: string; key: string; repeatable?: boolean }>;
    integerFlags?: Array<{ flag: string; key: string; min?: number; repeatable?: boolean }>;
    booleanFlags?: Array<{ flag: string; key: string; value?: boolean }>;
  }
): { outputMode: OutputMode; rawArgs: Record<string, unknown>; positional: string[] } | { outputMode: OutputMode; error: string } {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const rawArgs: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    const booleanFlag = config.booleanFlags?.find((flag) => arg === flag.flag);
    if (booleanFlag) {
      rawArgs[booleanFlag.key] = booleanFlag.value ?? true;
      continue;
    }

    const stringFlag = config.stringFlags?.find((flag) => arg === flag.flag || arg.startsWith(`${flag.flag}=`));
    if (stringFlag) {
      const value = readFlagValue(args, index, arg, stringFlag.flag);
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      if (stringFlag.repeatable) {
        const current = Array.isArray(rawArgs[stringFlag.key]) ? (rawArgs[stringFlag.key] as string[]) : [];
        rawArgs[stringFlag.key] = [...current, value.value.trim()];
      } else {
        rawArgs[stringFlag.key] = value.value.trim();
      }

      index = value.nextIndex;
      continue;
    }

    const integerFlag = config.integerFlags?.find((flag) => arg === flag.flag || arg.startsWith(`${flag.flag}=`));
    if (integerFlag) {
      const value = readIntegerFlagValue(args, index, arg, integerFlag.flag, { min: integerFlag.min });
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      if (integerFlag.repeatable) {
        const current = Array.isArray(rawArgs[integerFlag.key]) ? (rawArgs[integerFlag.key] as number[]) : [];
        rawArgs[integerFlag.key] = [...current, value.value];
      } else {
        rawArgs[integerFlag.key] = value.value;
      }
      index = value.nextIndex;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  return { outputMode, rawArgs, positional };
}

function parseAppsListGlobalArgs(args: string[]): AppsDiscoveryParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--owner', key: 'owner' },
      { flag: '--appname', key: 'appname' },
      { flag: '--hash', key: 'hash' },
    ],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps list-global\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsGlobalStatusArgs(args: string[]): AppsDiscoveryParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--zelid', key: 'zelid' },
      { flag: '--appname', key: 'appname' },
    ],
    integerFlags: [{ flag: '--limit', key: 'limit', min: 1 }],
    booleanFlags: [{ flag: '--include-expired', key: 'includeExpired' }],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps global-status\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsTroubleshootArgs(args: string[]): AppsTroubleshootParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [{ flag: '--appname', key: 'appname' }],
    booleanFlags: [{ flag: '--deep', key: 'deep' }],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps troubleshoot\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const positionalAppname = parsed.positional[0]?.trim() || null;
  const flagAppname = typeof parsed.rawArgs.appname === 'string' && parsed.rawArgs.appname.trim()
    ? String(parsed.rawArgs.appname).trim()
    : null;

  if (positionalAppname && flagAppname && positionalAppname !== flagAppname) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the app name either positionally or via --appname, not both with different values.',
    };
  }

  const appname = positionalAppname ?? flagAppname;
  if (!appname) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux apps troubleshoot <appname> [--deep] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    appname,
    rawArgs: {
      ...parsed.rawArgs,
      appname,
    },
    positional: [],
  };
}

function parseAppsRuntimeTargetArgs(
  args: string[],
  options: {
    command: string;
    usage: string;
    stringFlags?: Array<{ flag: string; key: string; repeatable?: boolean }>;
    integerFlags?: Array<{ flag: string; key: string; min?: number }>;
    booleanFlags?: Array<{ flag: string; key: string; value?: boolean }>;
  }
): AppsTroubleshootParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [{ flag: '--appname', key: 'appname' }, ...(options.stringFlags ?? [])],
    integerFlags: options.integerFlags,
    booleanFlags: options.booleanFlags,
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps ${options.command}\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const positionalAppname = parsed.positional[0]?.trim() || null;
  const flagAppname = typeof parsed.rawArgs.appname === 'string' && parsed.rawArgs.appname.trim()
    ? String(parsed.rawArgs.appname).trim()
    : null;

  if (positionalAppname && flagAppname && positionalAppname !== flagAppname) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the app name either positionally or via --appname, not both with different values.',
    };
  }

  const appname = positionalAppname ?? flagAppname;
  if (!appname) {
    return {
      outputMode: parsed.outputMode,
      error: options.usage,
    };
  }

  return {
    outputMode: parsed.outputMode,
    appname,
    rawArgs: {
      ...parsed.rawArgs,
      appname,
    },
    positional: [],
  };
}

function parseAppsHealthArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'health',
    usage: 'Usage: flux apps health [<appname>] [--appname <name>] [--logs-lines <n>] [--monitor-range-ms <ms>] [--json|--pretty|--raw]',
    integerFlags: [
      { flag: '--logs-lines', key: 'logsLines', min: 1 },
      { flag: '--monitor-range-ms', key: 'monitorRangeMs', min: 1000 },
    ],
  });
}

function parseAppsLogsArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'logs',
    usage: 'Usage: flux apps logs [<appname>] [--appname <name>] [--lines <count|all>] [--json|--pretty|--raw]',
    stringFlags: [{ flag: '--lines', key: 'lines' }],
  });
}

function parseAppsInspectArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'inspect',
    usage: 'Usage: flux apps inspect [<appname>] [--appname <name>] [--json|--pretty|--raw]',
  });
}

function parseAppsStatsArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'stats',
    usage: 'Usage: flux apps stats [<appname>] [--appname <name>] [--json|--pretty|--raw]',
  });
}

function parseAppsTopArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'top',
    usage: 'Usage: flux apps top [<appname>] [--appname <name>] [--json|--pretty|--raw]',
  });
}

function parseAppsMonitorArgs(args: string[]): AppsTroubleshootParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'monitor',
    usage: 'Usage: flux apps monitor [<appname>] [--appname <name>] [--range <ms>] [--json|--pretty|--raw]',
    integerFlags: [{ flag: '--range', key: 'range', min: 1 }],
  });
}

function parseAppsExecArgs(args: string[]): AppsTroubleshootParseResult {
  const parsed = parseAppsRuntimeTargetArgs(args, {
    command: 'exec',
    usage:
      'Usage: flux apps exec [<appname>] [--appname <name>] --cmd <segment> [--cmd <segment> ...] [--env KEY=VALUE ...] [--confirm] [--json|--pretty|--raw]',
    stringFlags: [
      { flag: '--cmd', key: 'cmd', repeatable: true },
      { flag: '--env', key: 'env', repeatable: true },
    ],
    booleanFlags: [{ flag: '--confirm', key: 'confirm' }],
  });

  if ('error' in parsed) return parsed;
  const cmd = Array.isArray(parsed.rawArgs.cmd) ? parsed.rawArgs.cmd : [];
  if (cmd.length === 0) {
    return {
      outputMode: parsed.outputMode,
      error:
        'Usage: flux apps exec [<appname>] [--appname <name>] --cmd <segment> [--cmd <segment> ...] [--env KEY=VALUE ...] [--confirm] [--json|--pretty|--raw]',
    };
  }

  return parsed;
}

function parseAppsStartArgs(args: string[]): AppsLifecycleParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'start',
    usage: 'Usage: flux apps start [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]',
    booleanFlags: [
      { flag: '--global', key: 'global' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });
}

function parseAppsStopArgs(args: string[]): AppsLifecycleParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'stop',
    usage: 'Usage: flux apps stop [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]',
    booleanFlags: [
      { flag: '--global', key: 'global' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });
}

function parseAppsRestartArgs(args: string[]): AppsLifecycleParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'restart',
    usage: 'Usage: flux apps restart [<appname>] [--appname <name>] [--global] [--confirm] [--json|--pretty|--raw]',
    booleanFlags: [
      { flag: '--global', key: 'global' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });
}

function parseAppsRedeployArgs(args: string[]): AppsLifecycleParseResult {
  return parseAppsRuntimeTargetArgs(args, {
    command: 'redeploy',
    usage:
      'Usage: flux apps redeploy [<appname>] [--appname <name>] [--force] [--global] [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]',
    integerFlags: [{ flag: '--timeout-ms', key: 'timeoutMs', min: 1 }],
    booleanFlags: [
      { flag: '--force', key: 'force' },
      { flag: '--global', key: 'global' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });
}

function parseAppsRedeployComponentArgs(args: string[]): AppsRedeployComponentParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--appname', key: 'appname' },
      { flag: '--component', key: 'component' },
    ],
    integerFlags: [{ flag: '--timeout-ms', key: 'timeoutMs', min: 1 }],
    booleanFlags: [
      { flag: '--force', key: 'force' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 2) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps redeploy-component\`: ${parsed.positional.slice(2).join(' ')}`,
    };
  }

  const positionalAppname = parsed.positional[0]?.trim() || null;
  const positionalComponent = parsed.positional[1]?.trim() || null;
  const flagAppname = typeof parsed.rawArgs.appname === 'string' && parsed.rawArgs.appname.trim()
    ? String(parsed.rawArgs.appname).trim()
    : null;
  const flagComponent = typeof parsed.rawArgs.component === 'string' && parsed.rawArgs.component.trim()
    ? String(parsed.rawArgs.component).trim()
    : null;

  if (positionalAppname && flagAppname && positionalAppname !== flagAppname) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the app name either positionally or via --appname, not both with different values.',
    };
  }

  if (positionalComponent && flagComponent && positionalComponent !== flagComponent) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the component either positionally or via --component, not both with different values.',
    };
  }

  const appname = positionalAppname ?? flagAppname;
  if (!appname) {
    return {
      outputMode: parsed.outputMode,
      error:
        'Usage: flux apps redeploy-component [<appname>] [<component>] [--appname <name>] [--component <name>] [--force] [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]',
    };
  }

  const component = positionalComponent ?? flagComponent;
  if (!component) {
    return {
      outputMode: parsed.outputMode,
      error:
        'Usage: flux apps redeploy-component [<appname>] [<component>] [--appname <name>] [--component <name>] [--force] [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    appname,
    component,
    rawArgs: {
      ...parsed.rawArgs,
      appname,
      component,
    },
    positional: [],
  };
}

function parseAppsTestInstallArgs(args: string[]): AppsTestInstallParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [{ flag: '--hash', key: 'hash' }],
    integerFlags: [{ flag: '--timeout-ms', key: 'timeoutMs', min: 1 }],
    booleanFlags: [{ flag: '--confirm', key: 'confirm' }],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps test-install\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const positionalHash = parsed.positional[0]?.trim() || null;
  const flagHash = typeof parsed.rawArgs.hash === 'string' && parsed.rawArgs.hash.trim()
    ? String(parsed.rawArgs.hash).trim()
    : null;

  if (positionalHash && flagHash && positionalHash !== flagHash) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the registration hash either positionally or via --hash, not both with different values.',
    };
  }

  const hash = positionalHash ?? flagHash;
  if (!hash) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux apps test-install <hash> [--timeout-ms <ms>] [--confirm] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    hash,
    rawArgs: {
      ...parsed.rawArgs,
      hash,
    },
    positional: [],
  };
}

function resolveAppsSpecInputSource(
  rawArgs: Record<string, unknown>,
  outputMode: OutputMode,
  usage: string,
  opts?: { optional?: boolean }
): AppsSpecInputSource | { outputMode: OutputMode; error: string } {
  const file = typeof rawArgs.specFile === 'string' && rawArgs.specFile.trim() ? rawArgs.specFile.trim() : null;
  const json = typeof rawArgs.specJson === 'string' && rawArgs.specJson.trim() ? rawArgs.specJson.trim() : null;
  const resourceUri = typeof rawArgs.specResourceUri === 'string' && rawArgs.specResourceUri.trim()
    ? rawArgs.specResourceUri.trim()
    : null;

  const provided = [
    file ? ({ kind: 'file', value: file } satisfies AppsSpecInputSource) : null,
    json ? ({ kind: 'json', value: json } satisfies AppsSpecInputSource) : null,
    resourceUri ? ({ kind: 'resource', value: resourceUri } satisfies AppsSpecInputSource) : null,
  ].filter((entry): entry is AppsSpecInputSource => entry !== null);

  if (provided.length > 1) {
    return {
      outputMode,
      error: 'Provide exactly one of --spec-file, --spec-json, or --spec-resource-uri.',
    };
  }

  if (provided.length === 0) {
    if (opts?.optional === true) {
      return { kind: 'json', value: '' };
    }

    return {
      outputMode,
      error: usage,
    };
  }

  return provided[0];
}

function parseAppsGenerateSpecArgs(args: string[]): AppsGenerateSpecParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--name', key: 'name' },
      { flag: '--owner', key: 'owner' },
      { flag: '--repotag', key: 'repotag' },
      { flag: '--app-description', key: 'appDescription' },
      { flag: '--component-name', key: 'componentName' },
      { flag: '--component-description', key: 'componentDescription' },
      { flag: '--domain', key: 'domains', repeatable: true },
      { flag: '--env', key: 'environment', repeatable: true },
      { flag: '--command', key: 'commands', repeatable: true },
      { flag: '--container-data', key: 'containerData' },
      { flag: '--enterprise', key: 'enterprise' },
    ],
    integerFlags: [
      { flag: '--port', key: 'ports', min: 1, repeatable: true },
      { flag: '--container-port', key: 'containerPorts', min: 1, repeatable: true },
      { flag: '--instances', key: 'instances', min: 1 },
      { flag: '--cpu', key: 'cpu', min: 1 },
      { flag: '--ram', key: 'ram', min: 1 },
      { flag: '--hdd', key: 'hdd', min: 1 },
    ],
    booleanFlags: [{ flag: '--staticip', key: 'staticip' }],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps generate-spec\`: ${parsed.positional.join(' ')}`,
    };
  }

  const usage =
    'Usage: flux apps generate-spec --name <name> --owner <zelid> --repotag <repo:tag> [--app-description <text>] [--component-name <name>] [--component-description <text>] [--port <port> ...] [--container-port <port> ...] [--domain <domain> ...] [--env KEY=VALUE ...] [--command <command> ...] [--instances <n>] [--cpu <n>] [--ram <mb>] [--hdd <gb>] [--container-data <path>] [--staticip] [--enterprise <value>] [--json|--pretty|--raw]';

  const name = typeof parsed.rawArgs.name === 'string' ? parsed.rawArgs.name.trim() : '';
  const owner = typeof parsed.rawArgs.owner === 'string' ? parsed.rawArgs.owner.trim() : '';
  const repotag = typeof parsed.rawArgs.repotag === 'string' ? parsed.rawArgs.repotag.trim() : '';
  if (!name || !owner || !repotag) {
    return {
      outputMode: parsed.outputMode,
      error: usage,
    };
  }

  return {
    outputMode: parsed.outputMode,
    rawArgs: {
      ...parsed.rawArgs,
      name,
      owner,
      repotag,
    },
    positional: [],
  };
}

function parseAppsSpecInputArgs(
  args: string[],
  options: {
    usage: string;
    integerFlags?: Array<{ flag: string; key: string; min?: number }>;
    booleanFlags?: Array<{ flag: string; key: string; value?: boolean }>;
    stringFlags?: Array<{ flag: string; key: string; repeatable?: boolean }>;
  }
): AppsSpecInputParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--spec-file', key: 'specFile' },
      { flag: '--spec-json', key: 'specJson' },
      { flag: '--spec-resource-uri', key: 'specResourceUri' },
      ...(options.stringFlags ?? []),
    ],
    integerFlags: options.integerFlags,
    booleanFlags: options.booleanFlags,
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments: ${parsed.positional.join(' ')}`,
    };
  }

  const specSource = resolveAppsSpecInputSource(parsed.rawArgs, parsed.outputMode, options.usage);
  if ('error' in specSource) return specSource;

  return {
    outputMode: parsed.outputMode,
    rawArgs: parsed.rawArgs,
    specSource,
    positional: [],
  };
}

function parseAppsVerifyRegistrationArgs(args: string[]): AppsSpecInputParseResult {
  const usage =
    'Usage: flux apps verify-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]';
  const parsed = parseAppsSpecInputArgs(args, { usage });
  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps verify-registration\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsVerifyUpdateArgs(args: string[]): AppsSpecInputParseResult {
  const usage =
    'Usage: flux apps verify-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]';
  const parsed = parseAppsSpecInputArgs(args, { usage });
  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps verify-update\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsCalculatePriceArgs(args: string[]): AppsSpecInputParseResult {
  const usage =
    'Usage: flux apps calculate-price (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--json|--pretty|--raw]';
  const parsed = parseAppsSpecInputArgs(args, { usage });
  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps calculate-price\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsPlanRegistrationArgs(args: string[]): AppsSpecInputParseResult {
  const usage =
    'Usage: flux apps plan-registration (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]';
  const parsed = parseAppsSpecInputArgs(args, {
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
    ],
  });
  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps plan-registration\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function parseAppsPlanUpdateArgs(args: string[]): AppsSpecInputParseResult {
  const usage =
    'Usage: flux apps plan-update (--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]';
  const parsed = parseAppsSpecInputArgs(args, {
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
    ],
  });
  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps plan-update\`: ${parsed.positional.join(' ')}`,
    };
  }

  return parsed;
}

function resolveAppsSubmissionInputSource(
  rawArgs: Record<string, unknown>,
  outputMode: OutputMode,
  usage: string
): AppsSubmissionInputSource | { outputMode: OutputMode; error: string } {
  const plan = typeof rawArgs.planResourceUri === 'string' && rawArgs.planResourceUri.trim()
    ? ({ kind: 'plan', value: rawArgs.planResourceUri.trim() } satisfies AppsSubmissionInputSource)
    : null;
  const specSource = resolveAppsSpecInputSource(rawArgs, outputMode, usage, { optional: true });
  if ('error' in specSource) return specSource;

  const provided = [
    plan,
    specSource.value ? specSource : null,
  ].filter((entry): entry is AppsSubmissionInputSource => entry !== null);

  if (provided.length > 1) {
    return {
      outputMode,
      error: 'Provide exactly one of --plan-resource-uri, --spec-file, --spec-json, or --spec-resource-uri.',
    };
  }

  if (provided.length === 0) {
    return {
      outputMode,
      error: usage,
    };
  }

  return provided[0];
}

function parseAppsSubmissionArgs(
  args: string[],
  options: {
    command: string;
    usage: string;
    integerFlags?: Array<{ flag: string; key: string; min?: number }>;
    booleanFlags?: Array<{ flag: string; key: string; value?: boolean }>;
  }
): AppsSubmissionParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--plan-resource-uri', key: 'planResourceUri' },
      { flag: '--spec-file', key: 'specFile' },
      { flag: '--spec-json', key: 'specJson' },
      { flag: '--spec-resource-uri', key: 'specResourceUri' },
      { flag: '--signature', key: 'signature' },
    ],
    integerFlags: options.integerFlags,
    booleanFlags: options.booleanFlags,
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps ${options.command}\`: ${parsed.positional.join(' ')}`,
    };
  }

  const submissionSource = resolveAppsSubmissionInputSource(parsed.rawArgs, parsed.outputMode, options.usage);
  if ('error' in submissionSource) return submissionSource;

  const signature = typeof parsed.rawArgs.signature === 'string' ? parsed.rawArgs.signature.trim() : '';
  if (!signature) {
    return {
      outputMode: parsed.outputMode,
      error: options.usage,
    };
  }

  return {
    outputMode: parsed.outputMode,
    rawArgs: {
      ...parsed.rawArgs,
      signature,
    },
    submissionSource,
    positional: [],
  };
}

function parseAppsRegisterArgs(args: string[]): AppsSubmissionParseResult {
  const usage =
    'Usage: flux apps register (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first] [--json|--pretty|--raw]';
  return parseAppsSubmissionArgs(args, {
    command: 'register',
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
    ],
    booleanFlags: [
      { flag: '--verify-first', key: 'verifyFirst', value: true },
      { flag: '--no-verify-first', key: 'verifyFirst', value: false },
    ],
  });
}

function parseAppsUpdateArgs(args: string[]): AppsSubmissionParseResult {
  const usage =
    'Usage: flux apps update (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) --signature <sig> [--timestamp <ms>] [--type-version <n>] [--verify-first|--no-verify-first] [--include-payment|--no-include-payment] [--json|--pretty|--raw]';
  return parseAppsSubmissionArgs(args, {
    command: 'update',
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
    ],
    booleanFlags: [
      { flag: '--verify-first', key: 'verifyFirst', value: true },
      { flag: '--no-verify-first', key: 'verifyFirst', value: false },
      { flag: '--include-payment', key: 'includePayment', value: true },
      { flag: '--no-include-payment', key: 'includePayment', value: false },
    ],
  });
}

function parseAppsRegisterAndVerifyArgs(args: string[]): AppsSubmissionParseResult {
  const usage =
    'Usage: flux apps register-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>] [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first] [--verify-global|--no-verify-global] [--poll|--no-poll] [--confirm] [--json|--pretty|--raw]';
  return parseAppsSubmissionArgs(args, {
    command: 'register-and-verify',
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
      { flag: '--attempts', key: 'attempts', min: 1 },
      { flag: '--interval-ms', key: 'intervalMs', min: 0 },
      { flag: '--poll-timeout-ms', key: 'pollTimeoutMs', min: 1 },
    ],
    booleanFlags: [
      { flag: '--verify-first', key: 'verifyFirst', value: true },
      { flag: '--no-verify-first', key: 'verifyFirst', value: false },
      { flag: '--verify-global', key: 'verifyGlobal', value: true },
      { flag: '--no-verify-global', key: 'verifyGlobal', value: false },
      { flag: '--poll', key: 'poll', value: true },
      { flag: '--no-poll', key: 'poll', value: false },
      { flag: '--confirm', key: 'confirm', value: true },
    ],
  });
}

function parseAppsUpdateAndVerifyArgs(args: string[]): AppsSubmissionParseResult {
  const usage =
    'Usage: flux apps update-and-verify (--plan-resource-uri <uri> | --spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>) --signature <sig> [--timestamp <ms>] [--type-version <n>] [--attempts <n>] [--interval-ms <ms>] [--poll-timeout-ms <ms>] [--verify-first|--no-verify-first] [--verify-global|--no-verify-global] [--poll|--no-poll] [--include-payment|--no-include-payment] [--confirm] [--json|--pretty|--raw]';
  return parseAppsSubmissionArgs(args, {
    command: 'update-and-verify',
    usage,
    integerFlags: [
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
      { flag: '--attempts', key: 'attempts', min: 1 },
      { flag: '--interval-ms', key: 'intervalMs', min: 0 },
      { flag: '--poll-timeout-ms', key: 'pollTimeoutMs', min: 1 },
    ],
    booleanFlags: [
      { flag: '--verify-first', key: 'verifyFirst', value: true },
      { flag: '--no-verify-first', key: 'verifyFirst', value: false },
      { flag: '--verify-global', key: 'verifyGlobal', value: true },
      { flag: '--no-verify-global', key: 'verifyGlobal', value: false },
      { flag: '--poll', key: 'poll', value: true },
      { flag: '--no-poll', key: 'poll', value: false },
      { flag: '--include-payment', key: 'includePayment', value: true },
      { flag: '--no-include-payment', key: 'includePayment', value: false },
      { flag: '--confirm', key: 'confirm', value: true },
    ],
  });
}

function parseAppsHashArgs(
  args: string[],
  options: {
    command: string;
    usage: string;
    integerFlags?: Array<{ flag: string; key: string; min?: number }>;
    stringFlags?: Array<{ flag: string; key: string; repeatable?: boolean }>;
  }
): AppsHashParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [{ flag: '--hash', key: 'hash' }, ...(options.stringFlags ?? [])],
    integerFlags: options.integerFlags,
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps ${options.command}\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const positionalHash = parsed.positional[0]?.trim() || null;
  const flagHash = typeof parsed.rawArgs.hash === 'string' && parsed.rawArgs.hash.trim()
    ? String(parsed.rawArgs.hash).trim()
    : null;

  if (positionalHash && flagHash && positionalHash !== flagHash) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide the message hash either positionally or via --hash, not both with different values.',
    };
  }

  const hash = positionalHash ?? flagHash;
  if (!hash) {
    return {
      outputMode: parsed.outputMode,
      error: options.usage,
    };
  }

  return {
    outputMode: parsed.outputMode,
    rawArgs: {
      ...parsed.rawArgs,
      hash,
    },
    hash,
    positional: [],
  };
}

function parseAppsWaitPropagationArgs(args: string[]): AppsHashParseResult {
  return parseAppsHashArgs(args, {
    command: 'wait-propagation',
    usage: 'Usage: flux apps wait-propagation <hash> [--attempts <n>] [--interval-ms <ms>] [--timeout-ms <ms>] [--json|--pretty|--raw]',
    integerFlags: [
      { flag: '--attempts', key: 'attempts', min: 1 },
      { flag: '--interval-ms', key: 'intervalMs', min: 0 },
      { flag: '--timeout-ms', key: 'timeoutMs', min: 1 },
    ],
  });
}

function parseAppsMessagesArgs(args: string[]): AppsHashParseResult {
  return parseAppsHashArgs(args, {
    command: 'messages',
    usage: 'Usage: flux apps messages <hash> [--kind temporary|permanent|both] [--json|--pretty|--raw]',
    stringFlags: [{ flag: '--kind', key: 'kind' }],
  });
}

function parseAppsPlanRenewArgs(args: string[]): AppsPlanRenewParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--owner', key: 'owner' },
      { flag: '--spec-file', key: 'specFile' },
      { flag: '--spec-json', key: 'specJson' },
      { flag: '--spec-resource-uri', key: 'specResourceUri' },
      { flag: '--mode', key: 'mode' },
    ],
    integerFlags: [
      { flag: '--weeks', key: 'weeks', min: 1 },
      { flag: '--blocks-to-add', key: 'blocksToAdd', min: 0 },
      { flag: '--blocks-per-week', key: 'blocksPerWeek', min: 1 },
      { flag: '--seconds-per-block', key: 'secondsPerBlock', min: 1 },
      { flag: '--timestamp', key: 'timestamp', min: 1 },
      { flag: '--type-version', key: 'typeVersion', min: 1 },
    ],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length === 0 || parsed.positional[0].startsWith('-')) {
    return {
      outputMode: parsed.outputMode,
      error:
        'Usage: flux apps plan-renew <appname> [--owner <zelid>] [--spec-file <path> | --spec-json <json> | --spec-resource-uri <uri>] [--weeks <n>] [--blocks-to-add <n>] [--mode <from_now|add_to_remaining>] [--blocks-per-week <n>] [--seconds-per-block <n>] [--timestamp <ms>] [--type-version <n>] [--json|--pretty|--raw]',
    };
  }

  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps plan-renew\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const appname = parsed.positional[0].trim();
  const specSource = resolveAppsSpecInputSource(
    parsed.rawArgs,
    parsed.outputMode,
    '',
    { optional: true }
  );
  if ('error' in specSource) return specSource;

  return {
    outputMode: parsed.outputMode,
    rawArgs: {
      ...parsed.rawArgs,
      appname,
    },
    appname,
    specSource: specSource.value ? specSource : null,
    positional: [],
  };
}

function parseAppsByZelidArgs(args: string[]): AppsByZelidParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [{ flag: '--zelid', key: 'zelid' }],
    integerFlags: [
      { flag: '--seconds-per-block', key: 'secondsPerBlock', min: 1 },
      { flag: '--limit', key: 'limit', min: 1 },
    ],
    booleanFlags: [
      { flag: '--include-expired', key: 'includeExpired' },
      { flag: '--estimate-time-remaining', key: 'estimateTimeRemaining' },
    ],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps by-zelid\`: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const positionalZelid = parsed.positional[0]?.trim() || null;
  const flagZelid = typeof parsed.rawArgs.zelid === 'string' && parsed.rawArgs.zelid.trim() ? String(parsed.rawArgs.zelid).trim() : null;

  if (positionalZelid && flagZelid && positionalZelid !== flagZelid) {
    return {
      outputMode: parsed.outputMode,
      error: 'Provide ZelID either positionally or via --zelid, not both with different values.',
    };
  }

  const zelid = positionalZelid ?? flagZelid;
  return {
    outputMode: parsed.outputMode,
    rawArgs: {
      ...parsed.rawArgs,
      ...(zelid ? { zelid } : {}),
    },
    zelid,
    positional: [],
  };
}

function parseAppsGetSpecArgs(args: string[]): AppsGetSpecParseResult {
  const parsed = parseAppsFlagArgs(args, {
    booleanFlags: [{ flag: '--decrypt', key: 'decrypt' }],
  });

  if ('error' in parsed) return parsed;

  const [appname, ...rest] = parsed.positional;
  if (!appname || appname.startsWith('-')) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux apps get-spec <appname> [--decrypt] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    appname,
    rawArgs: {
      appname,
      ...(parsed.rawArgs.decrypt === true ? { decrypt: true } : {}),
    },
    positional: rest,
  };
}

function parseAppsGetSpecFullArgs(args: string[]): AppsGetSpecFullParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--owner', key: 'owner' },
      { flag: '--base-url', key: 'baseUrls', repeatable: true },
    ],
    integerFlags: [{ flag: '--timeout-ms', key: 'timeoutMs', min: 1 }],
    booleanFlags: [
      { flag: '--set-base-url-on-success', key: 'setBaseUrlOnSuccess', value: true },
      { flag: '--no-set-base-url-on-success', key: 'setBaseUrlOnSuccess', value: false },
      { flag: '--include-secrets', key: 'includeSecrets' },
      { flag: '--confirm', key: 'confirm' },
    ],
  });

  if ('error' in parsed) return parsed;

  const [appname, ...rest] = parsed.positional;
  if (!appname || appname.startsWith('-')) {
    return {
      outputMode: parsed.outputMode,
      error:
        'Usage: flux apps get-spec-full <appname> [--owner <zelid>] [--base-url <url> ...] [--timeout-ms <ms>] [--set-base-url-on-success|--no-set-base-url-on-success] [--include-secrets] [--confirm] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    appname,
    rawArgs: {
      appname,
      ...parsed.rawArgs,
    },
    positional: rest,
  };
}

function parseAppsGetOwnerArgs(args: string[]): AppsGetOwnerParseResult {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) return parsed;

  const [appname, ...rest] = parsed.positional;
  if (!appname || appname.startsWith('-')) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux apps get-owner <appname> [--json|--pretty|--raw]',
    };
  }

  return { outputMode: parsed.outputMode, appname, positional: rest };
}

function parseAppsGetPublicKeyArgs(args: string[]): AppsGetPublicKeyParseResult {
  const parsed = parseAppsFlagArgs(args, {
    stringFlags: [
      { flag: '--owner', key: 'owner' },
      { flag: '--name', key: 'name' },
    ],
  });

  if ('error' in parsed) return parsed;
  if (parsed.positional.length > 0) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments for \`flux apps get-public-key\`: ${parsed.positional.join(' ')}`,
    };
  }

  const owner = typeof parsed.rawArgs.owner === 'string' ? parsed.rawArgs.owner : '';
  const name = typeof parsed.rawArgs.name === 'string' ? parsed.rawArgs.name : '';

  if (!owner || !name) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux apps get-public-key --owner <zelid> --name <appname> [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    owner,
    name,
    positional: [],
  };
}

function parseAuthLoginArgs(args: string[]): AuthLoginParseResult {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const rawArgs: Record<string, unknown> = {
    verify: true,
    setZelidauth: true,
    checkPrivilege: true,
    autoPinGateway: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    if (arg === '--force') {
      rawArgs.force = true;
      continue;
    }

    if (arg === '--use-emergency-phrase') {
      rawArgs.useEmergencyPhrase = true;
      continue;
    }

    if (arg === '--zelid' || arg.startsWith('--zelid=')) {
      const value = readFlagValue(args, index, arg, '--zelid');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.zelid = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--signature' || arg.startsWith('--signature=')) {
      const value = readFlagValue(args, index, arg, '--signature');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.signature = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--login-phrase' || arg.startsWith('--login-phrase=')) {
      const value = readFlagValue(args, index, arg, '--login-phrase');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.loginPhrase = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--gateway-base-url' || arg.startsWith('--gateway-base-url=')) {
      const value = readFlagValue(args, index, arg, '--gateway-base-url');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.gatewayBaseUrl = value.value;
      index = value.nextIndex;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  const zelid = typeof rawArgs.zelid === 'string' ? rawArgs.zelid.trim() : '';
  if (!zelid) {
    return {
      outputMode,
      error:
        'Usage: flux auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>] [--gateway-base-url <url>] [--force] [--use-emergency-phrase] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode,
    rawArgs: {
      ...rawArgs,
      zelid,
      ...(typeof rawArgs.signature === 'string' ? { signature: rawArgs.signature.trim() } : {}),
      ...(typeof rawArgs.loginPhrase === 'string' ? { loginPhrase: rawArgs.loginPhrase } : {}),
      ...(typeof rawArgs.gatewayBaseUrl === 'string' ? { gatewayBaseUrl: rawArgs.gatewayBaseUrl.trim() } : {}),
    },
    positional,
  };
}

function parseAuthPhraseArgs(args: string[]): AuthPhraseParseResult {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const rawArgs: Record<string, unknown> = {
    force: true,
    autoPinGateway: true,
    verify: false,
    setZelidauth: false,
    checkPrivilege: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    if (arg === '--use-emergency-phrase') {
      rawArgs.useEmergencyPhrase = true;
      continue;
    }

    if (arg === '--zelid' || arg.startsWith('--zelid=')) {
      const value = readFlagValue(args, index, arg, '--zelid');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.zelid = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--gateway-base-url' || arg.startsWith('--gateway-base-url=')) {
      const value = readFlagValue(args, index, arg, '--gateway-base-url');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.gatewayBaseUrl = value.value;
      index = value.nextIndex;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  return {
    outputMode,
    rawArgs: {
      ...rawArgs,
      ...(typeof rawArgs.zelid === 'string' ? { zelid: rawArgs.zelid.trim() } : {}),
      ...(typeof rawArgs.gatewayBaseUrl === 'string' ? { gatewayBaseUrl: rawArgs.gatewayBaseUrl.trim() } : {}),
    },
    positional,
  };
}

function unwrapFluxStringValue(result: unknown): string | null {
  if (typeof result === 'string' && result.trim()) return result;

  if (looksLikeFluxRequestResult(result)) {
    const envelope = asRecord(result.data);
    const value = envelope?.data;
    return typeof value === 'string' && value.trim() ? value : null;
  }

  const record = asRecord(result);
  if (!record) return null;

  const dataValue = record.data;
  if (typeof dataValue === 'string' && dataValue.trim()) return dataValue;

  return null;
}

function redactAuthPhraseHumanGuidance(payload: Record<string, unknown>): Record<string, unknown> {
  const nextPayload = { ...payload };

  delete nextPayload.signLauncherHttpUrl;
  delete nextPayload.zelcoreLauncherHttpUrl;
  delete nextPayload.zelcoreSignLink;
  delete nextPayload.zelcoreClickableLink;
  delete nextPayload.zelcoreBracketedLink;
  delete nextPayload.zelcoreWarning;

  return nextPayload;
}

function buildAuthPhrasePlaceholderNextActions(zelid: string, loginPhrase: string): Array<Record<string, unknown>> {
  return [
    {
      command: 'flux auth login',
      arguments: {
        zelid,
        loginPhrase,
        signature: '<SIGNATURE>',
      },
    },
  ];
}

function normalizeAuthPhrasePayload(options: {
  activeProfile: string;
  baseUrl: string | null;
  phrasePath: 'normal' | 'emergency';
  loginPhrase: string;
  result?: Record<string, unknown>;
  resourceUri?: string;
  nextActions?: unknown[];
}): Record<string, unknown> {
  const result = options.result ?? {};
  const loginPhraseResourceUri = typeof result.loginPhraseResourceUri === 'string' ? result.loginPhraseResourceUri : undefined;
  const gatewayBaseUrl = typeof result.gatewayBaseUrl === 'string' ? result.gatewayBaseUrl : undefined;
  const pinnedBaseUrl = typeof result.pinnedBaseUrl === 'string' ? result.pinnedBaseUrl : undefined;
  const zelid = typeof result.zelid === 'string' && result.zelid.trim() ? result.zelid.trim() : '<ZELID>';
  const nextActions = Array.isArray(options.nextActions) && options.nextActions.length > 0
    ? options.nextActions
    : buildAuthPhrasePlaceholderNextActions(zelid, options.loginPhrase);

  return redactAuthPhraseHumanGuidance({
    ...result,
    ok: true,
    status: 'ok',
    activeProfile: options.activeProfile,
    baseUrl: pinnedBaseUrl || options.baseUrl,
    phrasePath: options.phrasePath,
    needSignature: true,
    loginPhrase: options.loginPhrase,
    ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
    ...(pinnedBaseUrl ? { pinnedBaseUrl } : {}),
    ...(loginPhraseResourceUri ? { loginPhraseResourceUri } : {}),
    ...(options.resourceUri ? { resourceUri: options.resourceUri } : {}),
    nextActions,
  });
}

function renderAuthPhrasePretty(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const zelid = typeof payload.zelid === 'string' && payload.zelid.trim() ? payload.zelid : '<provide --zelid to prefill auth login>';

  lines.push(`Login phrase ready for ${zelid}.`);

  if (typeof payload.activeProfile === 'string') {
    lines.push(`Active profile: ${payload.activeProfile}`);
  }

  if (typeof payload.baseUrl === 'string' && payload.baseUrl) {
    lines.push(`Base URL: ${payload.baseUrl}`);
  }

  lines.push(`Phrase path: ${payload.phrasePath === 'emergency' ? 'emergency' : 'normal'}`);

  if (typeof payload.gatewayBaseUrl === 'string' && payload.gatewayBaseUrl) {
    lines.push(`Gateway base URL: ${payload.gatewayBaseUrl}`);
  }

  if (typeof payload.pinnedBaseUrl === 'string' && payload.pinnedBaseUrl) {
    lines.push(`Pinned base URL: ${payload.pinnedBaseUrl}`);
  }

  if (typeof payload.loginPhrase === 'string' && payload.loginPhrase) {
    lines.push('Login phrase:');
    lines.push(payload.loginPhrase);
  }

  if (typeof payload.signLauncherHttpUrl === 'string' && payload.signLauncherHttpUrl) {
    lines.push(`Sign launcher (SSP Wallet or Zelcore): ${payload.signLauncherHttpUrl}`);
  } else {
    lines.push('Wallet helper: rerun with --zelid to get a local sign launcher that supports SSP Wallet or Zelcore.');
  }

  if (typeof payload.zelcoreLauncherHttpUrl === 'string' && payload.zelcoreLauncherHttpUrl) {
    lines.push(`Zelcore launcher: ${payload.zelcoreLauncherHttpUrl}`);
  }

  if (typeof payload.zelcoreSignLink === 'string' && payload.zelcoreSignLink) {
    lines.push(`Zelcore sign link: ${payload.zelcoreSignLink}`);
  }

  if (typeof payload.zelcoreWarning === 'string' && payload.zelcoreWarning) {
    lines.push(`Warning: ${payload.zelcoreWarning}`);
  }

  return lines.join('\n');
}

function extractAuthDiagnoseBaseUrl(result: Record<string, unknown>, fallbackBaseUrl: string | null): string | null {
  if (typeof result.baseUrl === 'string' && result.baseUrl.trim()) {
    return result.baseUrl;
  }

  const checks = Array.isArray(result.checks) ? result.checks : [];
  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (!checkRecord || checkRecord.name !== 'baseUrl') continue;

    if (typeof checkRecord.detail === 'string' && checkRecord.detail.trim()) {
      return checkRecord.detail;
    }
  }

  return fallbackBaseUrl;
}

function normalizeAuthDiagnosePayload(
  normalized: ToolCallNormalization,
  activeProfile: string,
  fallbackBaseUrl: string | null
): Record<string, unknown> {
  const result = asRecord(normalized.envelope.result) ?? {};

  return {
    ...result,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok ? 'ok' : failureStatus(normalized.failureKind ?? 'flux'),
    activeProfile,
    baseUrl: extractAuthDiagnoseBaseUrl(result, fallbackBaseUrl),
    checks: Array.isArray(result.checks) ? result.checks : [],
    nextSteps: Array.isArray(result.nextSteps) ? result.nextSteps : [],
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
  };
}

function renderCheckDetail(detail: unknown): string | null {
  if (detail === undefined) return null;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof detail === 'number' || typeof detail === 'boolean' || typeof detail === 'bigint') return String(detail);

  if (!detail || typeof detail !== 'object') return null;

  try {
    return JSON.stringify(detail);
  } catch {
    return null;
  }
}

function renderAuthDiagnosePretty(payload: Record<string, unknown>): string {
  const lines = [
    `Auth diagnose status: ${typeof payload.status === 'string' || typeof payload.status === 'number' ? String(payload.status) : 'unknown'}`,
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Base URL: ${typeof payload.baseUrl === 'string' ? payload.baseUrl : '<unset>'}`,
    'Checks:',
  ];

  const checks = Array.isArray(payload.checks) ? payload.checks : [];
  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (!checkRecord) continue;

    const name = typeof checkRecord.name === 'string' ? checkRecord.name : '<unknown>';
    const status = checkRecord.ok === true ? 'OK' : 'FAIL';
    const detail = renderCheckDetail(checkRecord.detail);
    lines.push(`- ${status} ${name}${detail ? `: ${detail}` : ''}`);
  }

  const nextSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  if (nextSteps.length > 0) {
    lines.push('Next steps:');
    for (const step of nextSteps) {
      if (typeof step === 'string' && step.trim()) {
        lines.push(`- ${step}`);
      }
    }
  }

  return lines.join('\n');
}

function mergeAuthLoginPayload(normalized: ToolCallNormalization, activeProfile: string): Record<string, unknown> {
  const result = asRecord(normalized.envelope.result) ?? {};

  return {
    ...result,
    ok: normalized.envelope.ok,
    status:
      typeof result.status === 'string' || typeof result.status === 'number'
        ? result.status
        : normalized.envelope.ok
          ? 'ok'
          : normalized.envelope.status,
    activeProfile,
    ...(normalized.envelope.resourceUri && result.resourceUri === undefined ? { resourceUri: normalized.envelope.resourceUri } : {}),
    ...(normalized.envelope.nextActions && result.nextActions === undefined ? { nextActions: normalized.envelope.nextActions } : {}),
  };
}

function renderAuthLoginPretty(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const zelid = typeof payload.zelid === 'string' ? payload.zelid : '<unknown>';
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl : null;
  const activeProfile = typeof payload.activeProfile === 'string' ? payload.activeProfile : null;

  if (payload.needSignature === true) {
    lines.push(`Login phrase ready for ${zelid}.`);
    if (activeProfile) lines.push(`Active profile: ${activeProfile}`);
    if (typeof payload.pinnedBaseUrl === 'string' && payload.pinnedBaseUrl) {
      lines.push(`Pinned base URL: ${payload.pinnedBaseUrl}`);
    }
    if (typeof payload.gatewayBaseUrl === 'string' && payload.gatewayBaseUrl) {
      lines.push(`Gateway base URL: ${payload.gatewayBaseUrl}`);
    }
    if (typeof payload.loginPhrase === 'string' && payload.loginPhrase) {
      lines.push('Login phrase:');
      lines.push(payload.loginPhrase);
    }
    if (typeof payload.signLauncherHttpUrl === 'string' && payload.signLauncherHttpUrl) {
      lines.push(`Sign launcher: ${payload.signLauncherHttpUrl}`);
    }
    if (typeof payload.zelcoreLauncherHttpUrl === 'string' && payload.zelcoreLauncherHttpUrl) {
      lines.push(`Zelcore launcher: ${payload.zelcoreLauncherHttpUrl}`);
    }
    if (typeof payload.zelcoreSignLink === 'string' && payload.zelcoreSignLink) {
      lines.push(`Zelcore sign link: ${payload.zelcoreSignLink}`);
    }

    return lines.join('\n');
  }

  lines.push(payload.alreadyAuthenticated === true ? `Already authenticated as ${zelid}.` : `Authenticated as ${zelid}.`);
  if (activeProfile) lines.push(`Active profile: ${activeProfile}`);
  lines.push(`Base URL: ${baseUrl ?? '<unset>'}`);

  if (typeof payload.privilege === 'string' && payload.privilege) {
    lines.push(`Privilege: ${payload.privilege}`);
  }

  return lines.join('\n');
}

function normalizeAuthStatusPayload(result: unknown, activeProfile: string): Record<string, unknown> {
  const record = asRecord(result) ?? {};

  return {
    ok: true,
    status: 'ok',
    activeProfile,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : null,
    auth: asRecord(record.zelidauth) ?? { present: false },
    ...(record.zelidauthCache !== undefined ? { authCache: record.zelidauthCache } : {}),
    ...(record.enterpriseKey !== undefined ? { enterpriseKey: record.enterpriseKey } : {}),
    ...(record.fluxDriveMwsBaseUrl !== undefined ? { fluxDriveMwsBaseUrl: record.fluxDriveMwsBaseUrl } : {}),
    ...(record.httpDefaults !== undefined ? { httpDefaults: record.httpDefaults } : {}),
  };
}

function renderAuthStatusPretty(payload: Record<string, unknown>): string {
  const auth = asRecord(payload.auth);
  return [
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Base URL: ${typeof payload.baseUrl === 'string' ? payload.baseUrl : '<unset>'}`,
    `Auth: ${auth?.present === true ? `present${typeof auth.zelid === 'string' ? ` (zelid: ${auth.zelid})` : ''}` : 'not set'}`,
  ].join('\n');
}

async function handleAuthLogin(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAuthLoginArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth login\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_auth_login', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Flux auth login failed.', io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const payload = mergeAuthLoginPayload(normalized, snapshot.activeProfile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAuthLoginPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthStatus(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth status\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_get_state', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read auth status.', io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const payload = normalizeAuthStatusPayload(normalized.envelope.result, snapshot.activeProfile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAuthStatusPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthPhrase(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAuthPhraseArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth phrase\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const phrasePath = parsed.rawArgs.useEmergencyPhrase === true ? 'emergency' : 'normal';
  const useAuthLogin = typeof parsed.rawArgs.zelid === 'string' && parsed.rawArgs.zelid.trim().length > 0;

  let payload: Record<string, unknown>;

  try {
    if (useAuthLogin) {
      const normalized = await executeToolCall('flux_auth_login', parsed.rawArgs, toolRuntime, mode);
      if (!normalized.envelope.ok) {
        return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not fetch auth phrase.', io, parsed.outputMode);
      }

      const result = asRecord(normalized.envelope.result) ?? {};
      const loginPhrase = typeof result.loginPhrase === 'string' ? result.loginPhrase : null;
      if (!loginPhrase) {
        return emitFailure('flux', 'Could not read login phrase from flux_auth_login.', io, parsed.outputMode);
      }

      payload = normalizeAuthPhrasePayload({
        activeProfile: snapshot.activeProfile,
        baseUrl: snapshot.profile.baseUrl,
        phrasePath,
        loginPhrase,
        result,
        resourceUri: normalized.envelope.resourceUri,
        nextActions: normalized.envelope.nextActions,
      });

      if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
        renderJson(io.stdout, payload);
      } else {
        writeLine(io.stdout, renderAuthPhrasePretty({ ...result, ...payload }));
      }

      return EXIT_CODE_SUCCESS;
    }

    const normalizedPhrase = await executeToolCall(
      phrasePath === 'emergency' ? 'flux_get_emergency_phrase' : 'flux_get_login_phrase',
      {},
      toolRuntime,
      mode
    );

    if (!normalizedPhrase.envelope.ok) {
      return emitFailure(
        normalizedPhrase.failureKind ?? 'flux',
        normalizedPhrase.envelope.error ?? 'Could not fetch auth phrase.',
        io,
        parsed.outputMode
      );
    }

    const loginPhrase = unwrapFluxStringValue(normalizedPhrase.envelope.result);
    if (!loginPhrase) {
      return emitFailure('flux', 'Could not read login phrase from Flux response.', io, parsed.outputMode);
    }

    payload = normalizeAuthPhrasePayload({
      activeProfile: snapshot.activeProfile,
      baseUrl: snapshot.profile.baseUrl,
      phrasePath,
      loginPhrase,
      nextActions: buildAuthPhrasePlaceholderNextActions('<ZELID>', loginPhrase),
    });

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
      return EXIT_CODE_SUCCESS;
    }

    const signLink = await executeToolCall('flux_build_zelcore_sign_link', { message: loginPhrase }, toolRuntime, mode);
    const signLinkResult = asRecord(signLink.envelope.result) ?? {};
    writeLine(
      io.stdout,
      renderAuthPhrasePretty({
        ...payload,
        ...signLinkResult,
      })
    );

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }
}

async function handleAuthDiagnose(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth diagnose\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_auth_diagnose', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const payload = normalizeAuthDiagnosePayload(normalized, snapshot.activeProfile, snapshot.profile.baseUrl);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAuthDiagnosePretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAuthSessionClear(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  action: 'clear' | 'logout'
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth ${action}\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const normalized = await executeToolCall('flux_clear_zelidauth', {}, toolRuntime, mode);
    if (!normalized.envelope.ok) {
      return emitFailure(
        normalized.failureKind ?? 'flux',
        normalized.envelope.error ?? 'Could not clear auth state.',
        io,
        parsed.outputMode
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action,
    target: 'auth',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `${action === 'logout' ? 'Logged out' : 'Cleared persisted auth'} for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthClear(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAuthSessionClear(args, io, toolRuntime, mode, 'clear');
}

async function handleAuthCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderAuthHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'login':
      return handleAuthLogin(rest, io, toolRuntime, mode);
    case 'phrase':
      return handleAuthPhrase(rest, io, toolRuntime, mode);
    case 'status':
      return handleAuthStatus(rest, io, toolRuntime, mode);
    case 'diagnose':
      return handleAuthDiagnose(rest, io, toolRuntime, mode);
    case 'logout':
      return handleAuthSessionClear(rest, io, toolRuntime, mode, 'logout');
    case 'clear':
      return handleAuthClear(rest, io, toolRuntime, mode);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown auth subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

type NodeGatewayParseResult =
  | {
      outputMode: OutputMode;
      gatewayBaseUrl: string | null;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

type NodeBaseUrlParseResult =
  | {
      outputMode: OutputMode;
      baseUrl: string;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

function parseNodeGatewayArgs(args: string[]): NodeGatewayParseResult {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return parsed;
  }

  if (parsed.positional.length > 1) {
    return {
      outputMode: parsed.outputMode,
      error: `Unexpected arguments: ${parsed.positional.slice(1).join(' ')}`,
    };
  }

  const gatewayBaseUrl = parsed.positional[0]?.trim() || null;
  return {
    outputMode: parsed.outputMode,
    gatewayBaseUrl,
    positional: parsed.positional,
  };
}

function parseNodeBaseUrlArgs(args: string[]): NodeBaseUrlParseResult {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return parsed;
  }

  const [baseUrl, ...rest] = parsed.positional;
  if (!baseUrl || baseUrl.startsWith('-')) {
    return {
      outputMode: parsed.outputMode,
      error: 'Usage: flux node use-base-url <base-url> [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode: parsed.outputMode,
    baseUrl,
    positional: rest,
  };
}

function normalizeNodeGatewayPayload(result: unknown, activeProfile: string, currentBaseUrl: string | null): Record<string, unknown> {
  const record = asRecord(result) ?? {};

  return {
    ok: true,
    status: typeof record.status === 'string' || typeof record.status === 'number' ? record.status : 'ok',
    activeProfile,
    gatewayBaseUrl: typeof record.gatewayBaseUrl === 'string' ? record.gatewayBaseUrl : currentBaseUrl,
    fluxnode: typeof record.fluxnode === 'string' ? record.fluxnode : null,
    ip: typeof record.ip === 'string' ? record.ip : null,
    recommendedBaseUrl: typeof record.recommendedBaseUrl === 'string' ? record.recommendedBaseUrl : null,
  };
}

function renderNodeResolveGatewayPretty(payload: Record<string, unknown>): string {
  return [
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Gateway base URL: ${typeof payload.gatewayBaseUrl === 'string' ? payload.gatewayBaseUrl : '<unset>'}`,
    `Flux node header: ${typeof payload.fluxnode === 'string' ? payload.fluxnode : '<unavailable>'}`,
    `Resolved IP: ${typeof payload.ip === 'string' ? payload.ip : '<unavailable>'}`,
    `Recommended base URL: ${typeof payload.recommendedBaseUrl === 'string' ? payload.recommendedBaseUrl : '<unavailable>'}`,
  ].join('\n');
}

function normalizeNodeUseGatewayPayload(
  result: unknown,
  activeProfile: string,
  state: PersistedProfileState
): Record<string, unknown> {
  const record = asRecord(result) ?? {};

  return {
    ok: true,
    status: typeof record.status === 'string' || typeof record.status === 'number' ? record.status : 'ok',
    activeProfile,
    gatewayBaseUrl: typeof record.gatewayBaseUrl === 'string' ? record.gatewayBaseUrl : null,
    fluxnode: typeof record.fluxnode === 'string' ? record.fluxnode : null,
    ip: typeof record.ip === 'string' ? record.ip : null,
    recommendedBaseUrl: typeof record.recommendedBaseUrl === 'string' ? record.recommendedBaseUrl : null,
    baseUrl: state.baseUrl,
    auth: summarizePersistedAuth(state.zelidauth),
    enterpriseKey: { present: Boolean(state.enterpriseKey) },
  };
}

function renderNodeUseGatewayPretty(payload: Record<string, unknown>): string {
  const auth = asRecord(payload.auth);
  return [
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Gateway base URL: ${typeof payload.gatewayBaseUrl === 'string' ? payload.gatewayBaseUrl : '<unset>'}`,
    `Pinned base URL: ${typeof payload.baseUrl === 'string' ? payload.baseUrl : '<unset>'}`,
    `Recommended base URL: ${typeof payload.recommendedBaseUrl === 'string' ? payload.recommendedBaseUrl : '<unavailable>'}`,
    `Auth: ${auth?.present === true ? `present${typeof auth.zelid === 'string' ? ` (zelid: ${auth.zelid})` : ''}` : 'not set'}`,
  ].join('\n');
}

function normalizeNodeUseBaseUrlPayload(
  requestedBaseUrl: string,
  state: PersistedProfileState,
  activeProfile: string
): Record<string, unknown> {
  return {
    ok: true,
    status: 'ok',
    activeProfile,
    requestedBaseUrl,
    baseUrl: state.baseUrl,
    auth: summarizePersistedAuth(state.zelidauth),
    enterpriseKey: { present: Boolean(state.enterpriseKey) },
  };
}

function renderNodeUseBaseUrlPretty(payload: Record<string, unknown>): string {
  const auth = asRecord(payload.auth);
  return [
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Requested base URL: ${typeof payload.requestedBaseUrl === 'string' ? payload.requestedBaseUrl : '<unset>'}`,
    `Normalized base URL: ${typeof payload.baseUrl === 'string' ? payload.baseUrl : '<unset>'}`,
    `Auth: ${auth?.present === true ? `present${typeof auth.zelid === 'string' ? ` (zelid: ${auth.zelid})` : ''}` : 'not set'}`,
  ].join('\n');
}

async function handleNodeResolveGateway(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseNodeGatewayArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const gatewayBaseUrl = parsed.gatewayBaseUrl ?? snapshot.profile.baseUrl;
  if (!gatewayBaseUrl) {
    return emitFailure('validation', 'No gateway baseUrl available. Pass one explicitly or configure a base URL first.', io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_resolve_gateway_node', { gatewayBaseUrl }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(
      normalized.failureKind ?? 'flux',
      normalized.envelope.error ?? 'Could not resolve gateway base URL.',
      io,
      parsed.outputMode
    );
  }

  const payload = normalizeNodeGatewayPayload(normalized.envelope.result, snapshot.activeProfile, gatewayBaseUrl);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderNodeResolveGatewayPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleNodeUseGateway(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseNodeGatewayArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const gatewayBaseUrl = parsed.gatewayBaseUrl ?? snapshot.profile.baseUrl;
  if (!gatewayBaseUrl) {
    return emitFailure('validation', 'No gateway baseUrl available. Pass one explicitly or configure a base URL first.', io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_set_base_url_from_gateway', { gatewayBaseUrl }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(
      normalized.failureKind ?? 'flux',
      normalized.envelope.error ?? 'Could not pin gateway base URL.',
      io,
      parsed.outputMode
    );
  }

  const nextSnapshot = await loadPersistedStateSnapshot();
  const payload = normalizeNodeUseGatewayPayload(normalized.envelope.result, nextSnapshot.activeProfile, nextSnapshot.profile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderNodeUseGatewayPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleNodeUseBaseUrl(args: string[], io: CliIo): Promise<number> {
  const parsed = parseNodeBaseUrlArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux node use-base-url\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let snapshot;
  try {
    await updatePersistedProfileState((current) => switchPersistedProfileBaseUrl(current, parsed.baseUrl));
    snapshot = await loadPersistedStateSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const payload = normalizeNodeUseBaseUrlPayload(parsed.baseUrl, snapshot.profile, snapshot.activeProfile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderNodeUseBaseUrlPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleNodeCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderNodeHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'resolve-gateway':
      return handleNodeResolveGateway(rest, io, toolRuntime, mode);
    case 'use-gateway':
      return handleNodeUseGateway(rest, io, toolRuntime, mode);
    case 'use-base-url':
      return handleNodeUseBaseUrl(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown node subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function readPersistedResourceValue(uri: string | null | undefined): Promise<unknown | null> {
  if (!uri) return null;

  const resource = await readCliResource(uri);
  if (!resource) return null;

  return parseStoredResourceValue(resource.text, resource.mimeType);
}

function buildCliGeneratedResourceUri(kind: string): string {
  return `flux://resource/${kind}/${randomUUID()}`;
}

async function persistJsonArtifactResource(
  kind: string,
  name: string,
  value: unknown,
  description?: string
): Promise<string> {
  const uri = buildCliGeneratedResourceUri(kind);
  await persistCliResource({
    descriptor: {
      uri,
      name,
      description,
      mimeType: 'application/json',
    },
    contents: {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2),
    },
  });

  return uri;
}

function asOptionalIntegerValue(value: unknown): number | null {
  const numeric = asOptionalNumberValue(value);
  if (numeric === null || !Number.isInteger(numeric)) return null;
  return numeric;
}

function unwrapSpecCandidate(value: unknown): Record<string, unknown> | null {
  const unwrapped = unwrapFluxPayloadFromValue(value);
  const record = asRecord(unwrapped);
  if (!record) return null;

  const nestedSpec = normalizeSpecValue(record.spec);
  if (nestedSpec) return nestedSpec;

  return normalizeSpecValue(unwrapped);
}

async function loadSpecFromSource(specSource: AppsSpecInputSource): Promise<Record<string, unknown>> {
  if (specSource.kind === 'resource') {
    const resourceValue = await readPersistedResourceValue(specSource.value);
    if (resourceValue === null) {
      throw new Error(`Resource not found: ${specSource.value}`);
    }

    const spec = unwrapSpecCandidate(resourceValue);
    if (!spec) {
      throw new Error(`Spec resource ${specSource.value} did not contain a JSON object spec.`);
    }

    return spec;
  }

  let text = specSource.value;
  if (specSource.kind === 'file') {
    try {
      text = await readFile(specSource.value, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read --spec-file ${specSource.value}: ${message}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${specSource.kind === 'file' ? `--spec-file ${specSource.value}` : '--spec-json'}: ${message}`);
  }

  const spec = unwrapSpecCandidate(parsed);
  if (!spec) {
    throw new Error('Spec input must decode to a JSON object or an object containing a `spec` field.');
  }

  return spec;
}

async function loadSubmissionMaterial(
  source: AppsSubmissionInputSource
): Promise<{
  spec: Record<string, unknown>;
  timestamp: number | null;
  typeVersion: number | null;
  requiresAuth: boolean | null;
  messageToSignResourceUri: string | null;
  payment: Record<string, unknown> | null;
  verifiedSpec: Record<string, unknown> | null;
  source: 'plan' | 'spec';
  planResourceUri: string | null;
}> {
  if (source.kind !== 'plan') {
    return {
      spec: await loadSpecFromSource(source),
      timestamp: null,
      typeVersion: null,
      requiresAuth: null,
      messageToSignResourceUri: null,
      payment: null,
      verifiedSpec: null,
      source: 'spec',
      planResourceUri: null,
    };
  }

  const resourceValue = await readPersistedResourceValue(source.value);
  if (resourceValue === null) {
    throw new Error(`Resource not found: ${source.value}`);
  }

  const resourceRecord = normalizePlanningResourceRecord(resourceValue);
  const verifiedSpec = unwrapSpecCandidate(resourceRecord.verified);
  const payloadSpec = asRecord(unwrapFluxPayloadFromValue(resourceRecord.payload))?.appSpecification;
  const spec = verifiedSpec
    ?? normalizeSpecValue(payloadSpec)
    ?? unwrapSpecCandidate(resourceRecord);

  if (!spec) {
    throw new Error(`Plan resource ${source.value} did not contain a reusable app spec.`);
  }

  return {
    spec,
    timestamp: asOptionalIntegerValue(resourceRecord.timestamp),
    typeVersion: asOptionalIntegerValue(resourceRecord.typeVersion),
    requiresAuth: asOptionalBooleanValue(resourceRecord.requiresAuth),
    messageToSignResourceUri: asOptionalStringValue(resourceRecord.messageToSignResourceUri),
    payment: normalizeSpecValue(resourceRecord.payment),
    verifiedSpec,
    source: 'plan',
    planResourceUri: source.value,
  };
}

function extractAppIdentityFromSpec(spec: Record<string, unknown>): { appname: string | null; owner: string | null } {
  return {
    appname: asOptionalStringValue(spec.name),
    owner: asOptionalStringValue(spec.owner),
  };
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function normalizePropagationState(temporaryPresent: boolean, permanentPresent: boolean): 'pending' | 'temporary' | 'permanent' {
  if (permanentPresent) return 'permanent';
  if (temporaryPresent) return 'temporary';
  return 'pending';
}

function countFluxPayloadItems(value: unknown): number {
  const payload = unwrapFluxPayloadFromValue(value);
  if (Array.isArray(payload)) return payload.length;
  return hasNonEmptyValue(payload) ? 1 : 0;
}

function extractFluxAmountFromValue(value: unknown): number | null {
  const record = asRecord(unwrapFluxPayloadFromValue(value));
  if (!record) return null;

  return asOptionalNumberValue(record.flux);
}

function normalizePriceShape(value: unknown): Record<string, unknown> | null {
  const record = asRecord(unwrapFluxPayloadFromValue(value));
  return record && Object.keys(record).length > 0 ? record : null;
}

function normalizePlanningStatus(result: Record<string, unknown>, ok: boolean): string {
  const explicit = asOptionalStringValue(result.status);
  if (explicit) return explicit;
  return ok ? 'ok' : 'planning_incomplete';
}

function normalizePlanningResourceRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function unwrapFluxPayloadFromValue(value: unknown): unknown {
  if (looksLikeFluxRequestResult(value)) {
    const requestRecord = value as Record<string, unknown>;
    const nested = asRecord(requestRecord.data);
    return nested && 'data' in nested ? nested.data : requestRecord.data;
  }

  const record = asRecord(value);
  if (record && typeof record.status === 'string' && 'data' in record) {
    return record.data;
  }

  return value;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

function asOptionalNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function asOptionalStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function normalizeRunningAppItems(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => ({
    app: asOptionalStringValue(entry.app) ?? asOptionalStringValue(entry.name) ?? null,
    component: asOptionalStringValue(entry.component),
    status: asOptionalStringValue(entry.status),
    ip: asOptionalStringValue(entry.ip),
    port: asOptionalNumberValue(entry.port) ?? asOptionalStringValue(entry.port),
  }));
}

function normalizeAllAppItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((name) => ({ name }));
}

function normalizeGlobalSpecItems(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => ({
    name: asOptionalStringValue(entry.name),
    owner: asOptionalStringValue(entry.owner),
    instances: asOptionalNumberValue(entry.instances) ?? asOptionalStringValue(entry.instances),
    height: asOptionalNumberValue(entry.height) ?? asOptionalStringValue(entry.height),
    expire: asOptionalNumberValue(entry.expire) ?? asOptionalStringValue(entry.expire),
    hash: asOptionalStringValue(entry.hash),
  }));
}

function normalizeByZelidItems(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => ({
    name: asOptionalStringValue(entry.name),
    owner: asOptionalStringValue(entry.owner),
    height: asOptionalNumberValue(entry.height),
    expire: asOptionalNumberValue(entry.expire),
    expireIn: asOptionalNumberValue(entry.expireIn),
    expirationHeight: asOptionalNumberValue(entry.expirationHeight),
    currentHeight: asOptionalNumberValue(entry.currentHeight),
    blocksRemaining: asOptionalNumberValue(entry.blocksRemaining),
    expired: entry.expired === true,
  }));
}

function normalizeGlobalStatusItems(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => ({
    name: asOptionalStringValue(entry.name),
    owner: asOptionalStringValue(entry.owner),
    hash: asOptionalStringValue(entry.hash),
    instances: asOptionalNumberValue(entry.instances),
    height: asOptionalNumberValue(entry.height),
    expirationHeight: asOptionalNumberValue(entry.expirationHeight),
    blocksRemaining: asOptionalNumberValue(entry.blocksRemaining),
    expired: entry.expired === true,
    hasTemporary: entry.hasTemporary === true,
    hasPermanent: entry.hasPermanent === true,
    propagationState: derivePropagationState(entry.hasTemporary === true, entry.hasPermanent === true),
  }));
}

function derivePropagationState(hasTemporary: boolean, hasPermanent: boolean): string {
  if (hasTemporary && hasPermanent) return 'temporary_and_permanent';
  if (hasTemporary) return 'temporary_only';
  if (hasPermanent) return 'permanent_only';
  return 'not_seen';
}

function deriveGlobalStatusRuntimeState(options: {
  hasMatch: boolean;
  locationsCount: number | null;
  localRunningCount: number | null;
}): string {
  if (!options.hasMatch) return 'not_found';
  if (typeof options.localRunningCount === 'number' && options.localRunningCount > 0) return 'running_on_current_node';
  if (typeof options.locationsCount === 'number' && options.locationsCount > 0) return 'not_running_on_current_node';
  return 'no_reported_locations';
}

function deriveTroubleshootRuntimeState(options: {
  globalExists: boolean;
  locationsCount: number;
  localRunningCount: number;
}): string {
  if (!options.globalExists) return 'not_in_global_registry';
  if (options.localRunningCount > 0) return 'running_on_this_node';
  if (options.locationsCount > 0) return 'not_running_on_this_node';
  return 'not_reported_anywhere';
}

function normalizeNextActionItems(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => ({
    ...entry,
    ...(asRecord(entry.arguments) ? { arguments: asRecord(entry.arguments) } : {}),
  }));
}

function classifyTroubleshootCategory(code: string | null): string {
  switch (code) {
    case 'global_registry_unreachable':
    case 'not_in_global_registry':
      return 'registry';
    case 'install_errors':
    case 'installing_in_progress':
      return 'deployment';
    case 'no_locations':
      return 'propagation';
    case 'not_running_on_node':
      return 'runtime';
    default:
      return 'diagnostic';
  }
}

function normalizeTroubleshootSuspects(value: unknown): Array<Record<string, unknown>> {
  return asObjectArray(value).map((entry) => {
    const code = asOptionalStringValue(entry.code);
    return {
      code,
      title: asOptionalStringValue(entry.title),
      severity: asOptionalStringValue(entry.severity) ?? 'low',
      category: classifyTroubleshootCategory(code),
      evidence: asRecord(entry.evidence) ?? {},
    };
  });
}

function buildGlobalStatusCorrelation(
  summary: Record<string, unknown>,
  resourcePayload: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  filters: Record<string, unknown>
): Record<string, unknown> {
  const appname = asOptionalStringValue(filters.appname);
  const firstItem = items[0];
  const locationsCount = asOptionalNumberValue(summary.locationsCount)
    ?? asOptionalNumberValue(asRecord(resourcePayload.location)?.count);
  const localRunningCount = asOptionalNumberValue(summary.localRunningCount)
    ?? asOptionalNumberValue(asRecord(resourcePayload.localRuntime)?.runningCount);

  return {
    appname,
    zelid: asOptionalStringValue(filters.zelid),
    currentHeight: asOptionalNumberValue(resourcePayload.currentHeight),
    locationsCount,
    localRunningCount,
    propagationState: firstItem
      ? asOptionalStringValue(firstItem.propagationState) ?? derivePropagationState(firstItem.hasTemporary === true, firstItem.hasPermanent === true)
      : appname
        ? 'not_found'
        : null,
    runtimeState: appname
      ? deriveGlobalStatusRuntimeState({
          hasMatch: Boolean(firstItem),
          locationsCount,
          localRunningCount,
        })
      : null,
  };
}

function buildGlobalStatusNextActions(filters: Record<string, unknown>, items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  const appname = asOptionalStringValue(filters.appname);

  if (appname) {
    actions.push({ tool: 'flux_apps_troubleshoot', arguments: { appname } });
  }

  const hash = asOptionalStringValue(items[0]?.hash);
  if (hash) {
    actions.push({ tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } });
  }

  return actions;
}

function buildTroubleshootCorrelation(summary: Record<string, unknown>, derived: Record<string, unknown>): Record<string, unknown> {
  const globalExists = summary.globalExists === true || derived.globalExists === true;
  const locationsCount = asOptionalNumberValue(summary.locationsCount) ?? asOptionalNumberValue(derived.locationCount) ?? 0;
  const installingCount = asOptionalNumberValue(summary.installingCount) ?? asOptionalNumberValue(derived.installingCount) ?? 0;
  const errorsCount = asOptionalNumberValue(summary.errorsCount) ?? asOptionalNumberValue(derived.errorsCount) ?? 0;
  const localRunningCount = asOptionalNumberValue(summary.localRunningCount) ?? asOptionalNumberValue(derived.localRunningCount) ?? 0;

  return {
    globalExists,
    locationsCount,
    installingCount,
    errorsCount,
    localRunningCount,
    runtimeState: deriveTroubleshootRuntimeState({
      globalExists,
      locationsCount,
      localRunningCount,
    }),
    deploymentState: errorsCount > 0
      ? 'errors_reported'
      : installingCount > 0
        ? 'installing'
        : locationsCount > 0
          ? 'deployed'
          : globalExists
            ? 'registered_without_locations'
            : 'not_registered',
  };
}

function normalizeSpecValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function splitNonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function parseJsonStringValue(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sumRecordNumberValues(value: Record<string, unknown> | null): number | null {
  if (!value) return null;

  let total = 0;
  let seen = false;
  for (const entryValue of Object.values(value)) {
    const numeric = asOptionalNumberValue(entryValue);
    if (numeric === null) continue;
    total += numeric;
    seen = true;
  }

  return seen ? total : null;
}

function normalizeInspectSummary(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value) ?? {};
  if (Object.keys(record).length === 0) return null;

  const config = asRecord(record.Config) ?? {};
  const state = asRecord(record.State) ?? {};
  const health = asRecord(state.Health) ?? {};

  return {
    containerName: asOptionalStringValue(record.Name)?.replace(/^\//, '') ?? null,
    image: asOptionalStringValue(config.Image),
    stateStatus: asOptionalStringValue(state.Status),
    running: asOptionalBooleanValue(state.Running),
    healthStatus: asOptionalStringValue(health.Status),
  };
}

function normalizeStatsSummary(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value) ?? {};
  if (Object.keys(record).length === 0) return null;

  const memory = asRecord(record.memory_stats) ?? {};
  const pids = asRecord(record.pids_stats) ?? {};
  const networksRaw = asRecord(record.networks) ?? {};

  let networkRxBytes = 0;
  let networkTxBytes = 0;
  let networkSeen = false;
  for (const entry of Object.values(networksRaw)) {
    const network = asRecord(entry) ?? {};
    const rx = asOptionalNumberValue(network.rx_bytes);
    const tx = asOptionalNumberValue(network.tx_bytes);
    if (rx !== null) {
      networkRxBytes += rx;
      networkSeen = true;
    }
    if (tx !== null) {
      networkTxBytes += tx;
      networkSeen = true;
    }
  }

  return {
    memoryUsageBytes: asOptionalNumberValue(memory.usage),
    memoryLimitBytes: asOptionalNumberValue(memory.limit),
    networkRxBytes: networkSeen ? networkRxBytes : null,
    networkTxBytes: networkSeen ? networkTxBytes : null,
    pidCount: asOptionalNumberValue(pids.current),
  };
}

function normalizeTopSummary(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value) ?? {};
  if (Object.keys(record).length === 0) return null;

  const titles = Array.isArray(record.Titles) ? record.Titles.filter((entry): entry is string => typeof entry === 'string') : [];
  const processes = Array.isArray(record.Processes)
    ? record.Processes.filter((entry): entry is unknown[] => Array.isArray(entry))
    : [];

  const firstRow = processes[0] ?? [];
  const firstCommand = firstRow.find((entry, index) => index > 0 && typeof entry === 'string' && entry.trim())
    ?? firstRow.find((entry) => typeof entry === 'string' && entry.trim());

  return {
    processCount: processes.length,
    columnCount: titles.length,
    titles,
    firstCommand: typeof firstCommand === 'string' ? firstCommand : null,
  };
}

function normalizeMonitorSummary(value: unknown): Record<string, unknown> | null {
  const items = asObjectArray(value);
  if (items.length === 0) return null;

  const timestamps = items.map((entry) => asOptionalNumberValue(entry.timestamp)).filter((entry): entry is number => entry !== null);
  const cpuTotals = items
    .map((entry) => sumRecordNumberValues(asRecord(entry.cpu) ?? null) ?? asOptionalNumberValue(entry.cpu))
    .filter((entry): entry is number => entry !== null);

  return {
    pointCount: items.length,
    firstTimestamp: timestamps[0] ?? null,
    lastTimestamp: timestamps[timestamps.length - 1] ?? null,
    maxCpu: cpuTotals.length > 0 ? Math.max(...cpuTotals) : null,
  };
}

function normalizeLogsSummary(value: unknown, fallbackPreview?: unknown): Record<string, unknown> {
  const text = typeof value === 'string'
    ? value
    : typeof fallbackPreview === 'string'
      ? fallbackPreview
      : JSON.stringify(value ?? fallbackPreview ?? null, null, 2);

  const lines = splitNonEmptyLines(text);
  const preview = Array.isArray(fallbackPreview)
    ? fallbackPreview.filter((entry): entry is string => typeof entry === 'string')
    : lines.slice(-Math.min(lines.length, 50));

  return {
    totalLineCount: lines.length,
    preview,
    previewLineCount: preview.length,
    lastLine: preview.length > 0 ? preview[preview.length - 1] : null,
  };
}

function normalizeExecOutputSummary(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? parseJsonStringValue(value) : value;
  const parsedRecord = asRecord(parsed) ?? {};
  const data = asRecord(parsedRecord.data) ?? {};
  const stdoutValue = typeof data.stdout === 'string' ? data.stdout : null;
  const stderrValue = typeof data.stderr === 'string' ? data.stderr : null;

  return {
    parsedJson: parsed !== null && parsed !== undefined && parsed !== value ? true : typeof value !== 'string',
    responseStatus: asOptionalStringValue(parsedRecord.status),
    stdoutPreview: stdoutValue ? splitNonEmptyLines(stdoutValue)[0] ?? stdoutValue.trim() : null,
    stderrPreview: stderrValue ? splitNonEmptyLines(stderrValue)[0] ?? stderrValue.trim() : null,
  };
}

function deriveProgressSemantic(resourcePayload: unknown): {
  ok: boolean | null;
  source: 'json' | 'events' | 'tool';
  status: string;
  message: string | null;
  lastEvent: string | null;
  eventCount: number;
  events: string[];
} {
  const payload = asRecord(resourcePayload) ?? {};
  const parsed = asRecord(payload.parsed) ?? {};
  const events = Array.isArray(parsed.events) ? parsed.events.filter((entry): entry is string => typeof entry === 'string') : [];
  const jsonObjects = Array.isArray(parsed.jsonObjects)
    ? parsed.jsonObjects.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];

  const lastJson = jsonObjects.length > 0 ? jsonObjects[jsonObjects.length - 1] : null;
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastJsonStatus = asOptionalStringValue(lastJson?.status)?.toLowerCase() ?? null;
  const lastJsonData = asRecord(lastJson?.data) ?? {};
  const lastJsonMessage = asOptionalStringValue(lastJsonData.message) ?? asOptionalStringValue(lastJson?.data);

  if (lastJsonStatus === 'success') {
    return {
      ok: true,
      source: 'json',
      status: 'success',
      message: lastJsonMessage,
      lastEvent,
      eventCount: events.length,
      events,
    };
  }

  if (lastJsonStatus === 'error' || lastJsonStatus === 'failed' || lastJsonStatus === 'failure') {
    return {
      ok: false,
      source: 'json',
      status: 'error',
      message: lastJsonMessage,
      lastEvent,
      eventCount: events.length,
      events,
    };
  }

  const loweredLastEvent = lastEvent?.toLowerCase() ?? '';
  if (loweredLastEvent.includes('error') || loweredLastEvent.includes('failed') || loweredLastEvent.includes('failure')) {
    return {
      ok: false,
      source: 'events',
      status: 'error',
      message: lastEvent,
      lastEvent,
      eventCount: events.length,
      events,
    };
  }

  if (loweredLastEvent.includes('success') || loweredLastEvent.includes('installed') || loweredLastEvent.includes('complete')) {
    return {
      ok: true,
      source: 'events',
      status: 'success',
      message: lastEvent,
      lastEvent,
      eventCount: events.length,
      events,
    };
  }

  return {
    ok: null,
    source: 'tool',
    status: 'pending',
    message: lastJsonMessage ?? lastEvent,
    lastEvent,
    eventCount: events.length,
    events,
  };
}

function normalizeRuntimeCommandStatus(normalized: ToolCallNormalization, successStatus = 'available'): string {
  if (normalized.envelope.ok) return successStatus;
  if (normalized.failureKind && normalized.failureKind !== 'flux') {
    return failureStatus(normalized.failureKind);
  }
  return 'error';
}

function deriveTestInstallSemantic(resourcePayload: unknown): {
  ok: boolean | null;
  source: 'json' | 'events' | 'tool';
  status: string;
  message: string | null;
  lastEvent: string | null;
  eventCount: number;
  events: string[];
} {
  return deriveProgressSemantic(resourcePayload);
}

function formatOperationLabel(value: string | null): string {
  if (!value) return 'Operation';
  return value
    .split('-')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

function renderAppsCollectionPretty(title: string, items: Array<Record<string, unknown>>, formatter: (item: Record<string, unknown>) => string): string {
  if (items.length === 0) return `${title} (0)\nNo matching apps.`;
  return [`${title} (${items.length})`, ...items.map(formatter)].join('\n');
}

function renderAppsListRunningPretty(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  return renderAppsCollectionPretty('Running apps', items, (item) => {
    const app = asOptionalStringValue(item.app) ?? '<unknown>';
    const component = asOptionalStringValue(item.component) ?? '-';
    const status = asOptionalStringValue(item.status) ?? '-';
    const ip = asOptionalStringValue(item.ip) ?? '-';
    const port = item.port ?? '-';
    return `- ${app} · component=${component} · status=${status} · ${ip}:${String(port)}`;
  });
}

function renderAppsListAllPretty(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  return renderAppsCollectionPretty('All apps', items, (item) => `- ${asOptionalStringValue(item.name) ?? '<unknown>'}`);
}

function renderAppsListGlobalPretty(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  const filters = asRecord(payload.filters) ?? {};
  const lines = [
    `Global app specs (${items.length})`,
    `Filters: owner=${asOptionalStringValue(filters.owner) ?? '-'} · appname=${asOptionalStringValue(filters.appname) ?? '-'} · hash=${asOptionalStringValue(filters.hash) ?? '-'}`,
  ];

  if (items.length === 0) {
    lines.push('No matching apps.');
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(
      `- ${asOptionalStringValue(item.name) ?? '<unknown>'} · owner=${asOptionalStringValue(item.owner) ?? '-'} · instances=${String(item.instances ?? '-')} · hash=${asOptionalStringValue(item.hash) ?? '-'}`
    );
  }

  return lines.join('\n');
}

function renderAppsByZelidPretty(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  const zelid = asOptionalStringValue(payload.zelid) ?? '<unknown>';
  const lines = [`Apps for ${zelid} (${items.length})`];

  if (items.length === 0) {
    lines.push('No matching apps.');
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(
      `- ${asOptionalStringValue(item.name) ?? '<unknown>'} · blocksLeft=${String(item.blocksRemaining ?? '-')} · expired=${item.expired === true ? 'yes' : 'no'}`
    );
  }

  return lines.join('\n');
}

function renderAppsGlobalStatusPretty(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  const propagation = asRecord(payload.propagation) ?? {};
  const correlation = asRecord(payload.correlation) ?? {};
  const nextActions = normalizeNextActionItems(payload.nextActions);
  const lines = [
    `Global status (${items.length})`,
    `Propagation: temp=${String(propagation.tempYes ?? 0)} · perm=${String(propagation.permYes ?? 0)} · both=${String(propagation.both ?? 0)} · neither=${String(propagation.neither ?? 0)}`,
  ];

  if (asOptionalStringValue(correlation.appname)) {
    lines.push(
      `Correlation: app=${asOptionalStringValue(correlation.appname) ?? '<unknown>'} · propagation=${asOptionalStringValue(correlation.propagationState) ?? '-'} · runtime=${asOptionalStringValue(correlation.runtimeState) ?? '-'} · locations=${String(correlation.locationsCount ?? '-')} · localRunning=${String(correlation.localRunningCount ?? '-')}`
    );
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    lines.push(`Error: ${payload.error}`);
  }

  if (items.length === 0) {
    lines.push('No matching apps.');
    if (nextActions.length > 0) {
      lines.push('Next actions:');
      for (const action of nextActions) lines.push(`- ${JSON.stringify(action)}`);
    }
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(
      `- ${asOptionalStringValue(item.name) ?? '<unknown>'} · hash=${asOptionalStringValue(item.hash) ?? '-'} · propagation=${asOptionalStringValue(item.propagationState) ?? '-'} · temp=${item.hasTemporary === true ? 'yes' : 'no'} · perm=${item.hasPermanent === true ? 'yes' : 'no'}`
    );
  }

  if (nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of nextActions) lines.push(`- ${JSON.stringify(action)}`);
  }

  return lines.join('\n');
}

function renderAppsTroubleshootPretty(payload: Record<string, unknown>): string {
  const appname = asOptionalStringValue(payload.appname) ?? '<unknown>';
  const correlation = asRecord(payload.correlation) ?? {};
  const suspects = normalizeTroubleshootSuspects(payload.suspects);
  const nextActions = normalizeNextActionItems(payload.nextActions);

  const lines = [
    `Troubleshoot ${appname}`,
    `Status: ${typeof payload.status === 'string' || typeof payload.status === 'number' ? String(payload.status) : 'unknown'}`,
    `Correlation: global=${correlation.globalExists === true ? 'yes' : 'no'} · locations=${String(correlation.locationsCount ?? 0)} · installing=${String(correlation.installingCount ?? 0)} · errors=${String(correlation.errorsCount ?? 0)} · localRunning=${String(correlation.localRunningCount ?? 0)} · runtime=${asOptionalStringValue(correlation.runtimeState) ?? '-'}`,
  ];

  if (typeof payload.error === 'string' && payload.error.trim()) {
    lines.push(`Error: ${payload.error}`);
  }

  if (suspects.length === 0) {
    lines.push('No suspects identified.');
  } else {
    lines.push(`Top suspect: ${asOptionalStringValue(suspects[0]?.code) ?? '<unknown>'}`);
    lines.push('Suspects:');
    for (const suspect of suspects) {
      lines.push(
        `- ${asOptionalStringValue(suspect.code) ?? '<unknown>'} · category=${asOptionalStringValue(suspect.category) ?? 'diagnostic'} · severity=${asOptionalStringValue(suspect.severity) ?? 'low'} · ${asOptionalStringValue(suspect.title) ?? 'No title provided'}`
      );
    }
  }

  if (nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of nextActions) lines.push(`- ${JSON.stringify(action)}`);
  }

  return lines.join('\n');
}

function renderAppsGetSpecPretty(payload: Record<string, unknown>): string {
  const spec = normalizeSpecValue(payload.spec);
  return [
    `Spec for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Enterprise detected: ${payload.enterpriseDetected === true ? 'yes' : 'no'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
    `Version: ${String(spec?.version ?? '-')}`,
  ].join('\n');
}

function renderAppsGetSpecFullPretty(payload: Record<string, unknown>): string {
  const lines = [
    `Full spec for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Enterprise: ${payload.enterprise === true ? 'yes' : 'no'}`,
  ];

  if (typeof payload.error === 'string' && payload.error.trim()) {
    lines.push(`Error: ${payload.error}`);
  }

  const resources = asRecord(payload.resources) ?? {};
  if (asOptionalStringValue(resources.mergedSpec)) {
    lines.push(`Merged spec resource: ${resources.mergedSpec}`);
  } else if (asOptionalStringValue(payload.resourceUri)) {
    lines.push(`Spec resource: ${payload.resourceUri}`);
  }

  if (typeof payload.warning === 'string' && payload.warning.trim()) {
    lines.push(`Warning: ${payload.warning}`);
  }

  return lines.join('\n');
}

function renderAppsGetOwnerPretty(payload: Record<string, unknown>): string {
  return `Owner for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}: ${asOptionalStringValue(payload.owner) ?? '<unknown>'}`;
}

function renderAppsGetPublicKeyPretty(payload: Record<string, unknown>): string {
  return [
    `Public key for ${asOptionalStringValue(payload.name) ?? '<unknown>'}`,
    `Owner: ${asOptionalStringValue(payload.owner) ?? '<unknown>'}`,
    `Public key: ${asOptionalStringValue(payload.publicKey) ?? '<unavailable>'}`,
  ].join('\n');
}

function renderAppsHealthPretty(payload: Record<string, unknown>): string {
  const health = asRecord(payload.health) ?? {};
  const lines = [
    `Health for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Checks: ${String(health.passedChecks ?? 0)}/${String(health.totalChecks ?? 0)} passed`,
  ];

  const failedChecks = Array.isArray(health.failedChecks) ? health.failedChecks.join(', ') : '';
  if (failedChecks) lines.push(`Failed: ${failedChecks}`);

  const resources = asRecord(payload.resources) ?? {};
  if (Object.keys(resources).length > 0) {
    lines.push('Resources:');
    for (const [key, value] of Object.entries(resources)) {
      lines.push(`- ${key}: ${String(value)}`);
    }
  }

  return lines.join('\n');
}

function renderAppsLogsPretty(payload: Record<string, unknown>): string {
  return [
    `Logs for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Target: ${asOptionalStringValue(payload.target) ?? '<unknown>'}`,
    `Preview lines: ${String(payload.previewLineCount ?? 0)} / ${String(payload.totalLineCount ?? 0)}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsInspectPretty(payload: Record<string, unknown>): string {
  const summary = asRecord(payload.inspectSummary) ?? {};
  return [
    `Inspect ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Container: ${asOptionalStringValue(summary.containerName) ?? '<unknown>'}`,
    `Image: ${asOptionalStringValue(summary.image) ?? '-'}`,
    `State: ${asOptionalStringValue(summary.stateStatus) ?? '-'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsStatsPretty(payload: Record<string, unknown>): string {
  const summary = asRecord(payload.statsSummary) ?? {};
  return [
    `Stats ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Memory: ${String(summary.memoryUsageBytes ?? '-')} / ${String(summary.memoryLimitBytes ?? '-')}`,
    `Network: rx=${String(summary.networkRxBytes ?? '-')} tx=${String(summary.networkTxBytes ?? '-')}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsTopPretty(payload: Record<string, unknown>): string {
  const summary = asRecord(payload.topSummary) ?? {};
  return [
    `Top ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Processes: ${String(summary.processCount ?? 0)}`,
    `First command: ${asOptionalStringValue(summary.firstCommand) ?? '-'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsMonitorPretty(payload: Record<string, unknown>): string {
  const summary = asRecord(payload.monitorSummary) ?? {};
  return [
    `Monitor ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Points: ${String(summary.pointCount ?? 0)}`,
    `Range: ${String(payload.range ?? '-')}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsExecPretty(payload: Record<string, unknown>): string {
  const outputSummary = asRecord(payload.outputSummary) ?? {};
  return [
    `Exec ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Target: ${asOptionalStringValue(payload.target) ?? '<unknown>'}`,
    `Command: ${Array.isArray(payload.cmd) ? payload.cmd.join(' ') : '-'}`,
    `Stdout preview: ${asOptionalStringValue(outputSummary.stdoutPreview) ?? '-'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsLifecyclePretty(payload: Record<string, unknown>): string {
  return [
    `${formatOperationLabel(asOptionalStringValue(payload.operation))} ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Global: ${String(payload.global === true)}`,
    `HTTP status: ${String(payload.httpStatus ?? '-')}`,
    `Flux status: ${asOptionalStringValue(payload.fluxStatus) ?? '-'}`,
    `Message: ${asOptionalStringValue(payload.message) ?? '-'}`,
  ].join('\n');
}

function renderAppsRedeployPretty(payload: Record<string, unknown>): string {
  return [
    `${formatOperationLabel(asOptionalStringValue(payload.operation))} ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    ...(asOptionalStringValue(payload.component) ? [`Component: ${asOptionalStringValue(payload.component)}`] : []),
    `Force: ${String(payload.force === true)}`,
    ...(Object.prototype.hasOwnProperty.call(payload, 'global') ? [`Global: ${String(payload.global === true)}`] : []),
    `Semantic source: ${asOptionalStringValue(payload.semanticSource) ?? '-'}`,
    `Events: ${String(payload.eventCount ?? 0)}`,
    `Last event: ${asOptionalStringValue(payload.lastEvent) ?? '-'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsTestInstallPretty(payload: Record<string, unknown>): string {
  return [
    `Test install ${asOptionalStringValue(payload.hash) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Semantic source: ${asOptionalStringValue(payload.semanticSource) ?? '-'}`,
    `Events: ${String(payload.eventCount ?? 0)}`,
    `Last event: ${asOptionalStringValue(payload.lastEvent) ?? '-'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsGenerateSpecPretty(payload: Record<string, unknown>): string {
  return [
    `Generated spec for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Owner: ${asOptionalStringValue(payload.owner) ?? '<unknown>'}`,
    `Version: ${String(asOptionalIntegerValue(payload.specVersion) ?? '-')}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsSpecValidationPretty(payload: Record<string, unknown>): string {
  return [
    `${asOptionalStringValue(payload.validation) === 'update' ? 'Update' : 'Registration'} spec validation`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `App: ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Owner: ${asOptionalStringValue(payload.owner) ?? '<unknown>'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsPricePretty(payload: Record<string, unknown>): string {
  return [
    `Price for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `FLUX: ${String(asOptionalNumberValue(payload.fluxAmount) ?? '-')}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsPlanPretty(payload: Record<string, unknown>): string {
  return [
    `Plan for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Type: ${asOptionalStringValue(payload.type) ?? '-'}`,
    `Requires auth: ${payload.requiresAuth === true ? 'yes' : 'no'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
    `Message resource: ${asOptionalStringValue(payload.messageToSignResourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsSubmissionPretty(payload: Record<string, unknown>): string {
  return [
    `${formatOperationLabel(asOptionalStringValue(payload.operation))} ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Owner: ${asOptionalStringValue(payload.owner) ?? '<unknown>'}`,
    `Hash: ${asOptionalStringValue(payload.hash) ?? '<none>'}`,
    `Source: ${asOptionalStringValue(payload.source) ?? '-'}`,
    `Plan resource: ${asOptionalStringValue(payload.planResourceUri) ?? '<none>'}`,
    `Message resource: ${asOptionalStringValue(payload.messageToSignResourceUri) ?? '<none>'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsPropagationPretty(payload: Record<string, unknown>): string {
  return [
    `${asOptionalStringValue(payload.operation) === 'messages' ? 'Messages' : 'Wait propagation'} ${asOptionalStringValue(payload.hash) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Kind: ${asOptionalStringValue(payload.kind) ?? 'both'}`,
    `Temporary present: ${String(payload.temporaryPresent === true)}`,
    `Permanent present: ${String(payload.permanentPresent === true)}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
  ].join('\n');
}

function renderAppsRenewPlanPretty(payload: Record<string, unknown>): string {
  return [
    `Renew plan for ${asOptionalStringValue(payload.appname) ?? '<unknown>'}`,
    `Status: ${asOptionalStringValue(payload.status) ?? 'unknown'}`,
    `Expire computed: ${String(asOptionalIntegerValue(payload.expireComputed) ?? '-')}`,
    `Enterprise: ${payload.isEnterprise === true ? 'yes' : 'no'}`,
    `Resource URI: ${asOptionalStringValue(payload.resourceUri) ?? '<none>'}`,
    ...(asOptionalStringValue(payload.specWarning) ? [`Warning: ${asOptionalStringValue(payload.specWarning)}`] : []),
  ].join('\n');
}

function renderAppsMetadataPretty(title: string, value: Record<string, unknown> | null): string {
  if (!value) return `${title}\nNo metadata returned.`;
  return [title, ...Object.entries(value).map(([key, entryValue]) => `- ${key}: ${typeof entryValue === 'object' ? JSON.stringify(entryValue) : String(entryValue)}`)].join('\n');
}

async function handleAppsListRunning(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps list-running\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_list_running', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not list running apps.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const items = normalizeRunningAppItems(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    items,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsListRunningPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsListAll(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps list-all\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_list_all', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not list apps.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const items = normalizeAllAppItems(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    items,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsListAllPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsListGlobal(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsListGlobalArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_list_global_specs', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not list global app specs.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const items = normalizeGlobalSpecItems(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    filters: {
      owner: asOptionalStringValue(summary.owner),
      appname: asOptionalStringValue(summary.appname),
      hash: asOptionalStringValue(summary.hash),
    },
    items,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsListGlobalPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsGlobalStatus(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGlobalStatusArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_global_status', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourcePayload = asRecord(await readPersistedResourceValue(normalized.envelope.resourceUri)) ?? {};
  const computed = normalizeGlobalStatusItems(resourcePayload.computed ?? resourcePayload.apps);
  const filters = {
    zelid: asOptionalStringValue(summary.zelid),
    appname: asOptionalStringValue(summary.appname),
    includeExpired: parsed.rawArgs.includeExpired === true,
    limit: typeof parsed.rawArgs.limit === 'number' ? parsed.rawArgs.limit : 50,
  };
  const correlation = buildGlobalStatusCorrelation(summary, resourcePayload, computed, filters);
  const nextActions = buildGlobalStatusNextActions(filters, computed);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok
      ? typeof summary.status === 'string' || typeof summary.status === 'number'
        ? summary.status
        : 'ok'
      : failureStatus(normalized.failureKind ?? 'flux'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    currentHeight: asOptionalNumberValue(resourcePayload.currentHeight),
    filters,
    correlation,
    nextActions,
    items: computed,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGlobalStatusPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsTroubleshoot(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsTroubleshootArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_troubleshoot', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourcePayload = asRecord(await readPersistedResourceValue(normalized.envelope.resourceUri)) ?? {};
  const derived = asRecord(resourcePayload.derived) ?? {};
  const suspects = normalizeTroubleshootSuspects(derived.suspects ?? summary.suspects);
  const nextActions = normalizeNextActionItems(summary.nextActions ?? derived.nextActions ?? normalized.envelope.nextActions);
  const correlation = buildTroubleshootCorrelation(summary, derived);
  const health = asRecord(resourcePayload.health);

  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok
      ? typeof summary.status === 'string' || typeof summary.status === 'number'
        ? summary.status
        : 'ok'
      : failureStatus(normalized.failureKind ?? 'flux'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    deep: parsed.rawArgs.deep === true,
    correlation,
    suspectCount: suspects.length,
    ...(suspects[0] ? { topSuspect: suspects[0] } : {}),
    suspects,
    nextActions,
    ...(health ? { health } : {}),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsTroubleshootPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsByZelid(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsByZelidArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_list_by_zelid_with_expiry', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not list apps by ZelID.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourcePayload = asRecord(await readPersistedResourceValue(normalized.envelope.resourceUri)) ?? {};
  const items = normalizeByZelidItems(resourcePayload.filtered ?? resourcePayload.apps);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    zelid: asOptionalStringValue(summary.zelid) ?? parsed.zelid,
    items,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsByZelidPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsGetSpec(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGetSpecArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps get-spec\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_get_spec', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read app spec.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const spec = normalizeSpecValue(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    spec,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGetSpecPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsGetSpecFull(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGetSpecFullArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps get-spec-full\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_get_spec_full', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resources = asRecord(summary.resources) ?? {};

  const mergedSpecValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.mergedSpec)));
  const baseSpecResourceUri = asOptionalStringValue(resources.baseSpec) ?? asOptionalStringValue(normalized.envelope.resourceUri);
  const baseSpecValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(baseSpecResourceUri));
  const enterprisePayloadValue = await readPersistedResourceValue(asOptionalStringValue(resources.enterpriseDecrypted));

  const mergedSpec = normalizeSpecValue(mergedSpecValue);
  const baseSpec = normalizeSpecValue(baseSpecValue);
  const spec = normalized.envelope.ok
    ? baseSpec && mergedSpec
      ? { ...baseSpec, ...mergedSpec }
      : mergedSpec ?? baseSpec
    : null;
  const enterprisePayload = normalized.envelope.ok ? normalizeSpecValue(enterprisePayloadValue) : null;

  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok
      ? typeof summary.status === 'string' || typeof summary.status === 'number'
        ? summary.status
        : 'ok'
      : failureStatus(normalized.failureKind ?? 'flux'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    ...(spec ? { spec } : {}),
    ...(enterprisePayload ? { enterprisePayload } : {}),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGetSpecFullPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsGetOwner(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGetOwnerArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps get-owner\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_get_owner', { appname: parsed.appname }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read app owner.', io, parsed.outputMode);
  }

  const owner = asOptionalStringValue(unwrapFluxPayloadFromValue(normalized.envelope.result));
  const payload = {
    ok: true,
    status: 'ok',
    appname: parsed.appname,
    owner,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGetOwnerPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsGetPublicKey(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGetPublicKeyArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_get_public_key', { owner: parsed.owner, name: parsed.name }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read app public key.', io, parsed.outputMode);
  }

  const publicKey = asOptionalStringValue(unwrapFluxPayloadFromValue(normalized.envelope.result));
  const payload = {
    ok: true,
    status: 'ok',
    owner: parsed.owner,
    name: parsed.name,
    publicKey,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGetPublicKeyPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsRegistrationInformation(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps registration-information\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_registration_information', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read registration information.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const registrationInformation = normalizeSpecValue(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    registrationInformation,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsMetadataPretty('Registration information', registrationInformation));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsDeploymentInformation(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux apps deployment-information\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_deployment_information', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read deployment information.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const deploymentInformation = normalizeSpecValue(resourceValue);
  const payload = {
    ...summary,
    ok: true,
    status: typeof summary.status === 'string' || typeof summary.status === 'number' ? summary.status : 'ok',
    deploymentInformation,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsMetadataPretty('Deployment information', deploymentInformation));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsHealth(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsHealthArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_app_health_report', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resources = asRecord(summary.resources) ?? {};
  const inspectValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.inspect)));
  const statsValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.stats)));
  const topValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.top)));
  const monitorValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.monitor)));
  const logsValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(asOptionalStringValue(resources.logs)));
  const checks: Record<string, { ok?: unknown; status?: unknown; summary: Record<string, unknown> | null }> = {
    inspect: { ...asRecord(summary.inspect), summary: normalizeInspectSummary(inspectValue) },
    stats: { ...asRecord(summary.stats), summary: normalizeStatsSummary(statsValue) },
    top: { ...asRecord(summary.top), summary: normalizeTopSummary(topValue) },
    monitor: { ...asRecord(summary.monitor), summary: normalizeMonitorSummary(monitorValue) },
    logs: { ...asRecord(summary.logs), summary: normalizeLogsSummary(logsValue) },
  };
  const checkEntries = Object.entries(checks);
  const passedChecks = checkEntries.filter(([, value]) => value.ok === true).map(([key]) => key);
  const failedChecks = checkEntries.filter(([, value]) => value.ok !== true).map(([key]) => key);
  const overallStatus = !normalized.envelope.ok && passedChecks.length === 0
    ? normalizeRuntimeCommandStatus(normalized)
    : failedChecks.length === 0
      ? 'healthy'
      : passedChecks.length > 0
        ? 'degraded'
        : 'error';

  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: overallStatus,
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    health: {
      overallStatus,
      totalChecks: checkEntries.length,
      passedChecks: passedChecks.length,
      failedChecks,
    },
    checks,
    resources,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsHealthPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsLogs(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsLogsArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_logs', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const logSummary = normalizeLogsSummary(resourceValue, summary.preview);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    resourceUri: normalized.envelope.resourceUri,
    ...logSummary,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsLogsPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsInspect(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsInspectArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_inspect', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    resourceUri: normalized.envelope.resourceUri,
    inspectSummary: normalizeInspectSummary(resourceValue),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsInspectPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsStats(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsStatsArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_stats', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    resourceUri: normalized.envelope.resourceUri,
    statsSummary: normalizeStatsSummary(resourceValue),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsStatsPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsTop(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsTopArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_top', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    resourceUri: normalized.envelope.resourceUri,
    topSummary: normalizeTopSummary(resourceValue),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsTopPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsMonitor(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsMonitorArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_monitor', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = unwrapFluxPayloadFromValue(await readPersistedResourceValue(normalized.envelope.resourceUri));
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    range: typeof parsed.rawArgs.range === 'number' ? parsed.rawArgs.range : asOptionalNumberValue(summary.range),
    resourceUri: normalized.envelope.resourceUri,
    monitorSummary: normalizeMonitorSummary(resourceValue),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsMonitorPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsExec(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsExecArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_exec', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = await readPersistedResourceValue(normalized.envelope.resourceUri);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok ? 'success' : normalizeRuntimeCommandStatus(normalized),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    appname: parsed.appname,
    httpStatus: asOptionalNumberValue(summary.status),
    resourceUri: normalized.envelope.resourceUri,
    outputSummary: normalizeExecOutputSummary(resourceValue),
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsExecPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsLifecycleMutation(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  options: {
    operation: 'start' | 'stop' | 'restart';
    toolName: 'flux_apps_start' | 'flux_apps_stop' | 'flux_apps_restart';
    parse: (args: string[]) => AppsLifecycleParseResult;
  }
): Promise<number> {
  const parsed = options.parse(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(options.toolName, parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const result = asRecord(normalized.envelope.result) ?? {};
  const nested = asRecord(result.data) ?? {};
  const data = asRecord(nested.data);
  const payload = {
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok ? 'success' : normalizeRuntimeCommandStatus(normalized, 'success'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    operation: options.operation,
    appname: parsed.appname,
    global: parsed.rawArgs.global === true,
    httpStatus: asOptionalNumberValue(result.status),
    fluxStatus: asOptionalStringValue(nested.status),
    message:
      asOptionalStringValue(data?.message)
      ?? asOptionalStringValue(nested.data)
      ?? asOptionalStringValue(result.message)
      ?? null,
    nextActions: normalizeNextActionItems(normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsLifecyclePretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsStart(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsLifecycleMutation(args, io, toolRuntime, mode, {
    operation: 'start',
    toolName: 'flux_apps_start',
    parse: parseAppsStartArgs,
  });
}

async function handleAppsStop(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsLifecycleMutation(args, io, toolRuntime, mode, {
    operation: 'stop',
    toolName: 'flux_apps_stop',
    parse: parseAppsStopArgs,
  });
}

async function handleAppsRestart(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsLifecycleMutation(args, io, toolRuntime, mode, {
    operation: 'restart',
    toolName: 'flux_apps_restart',
    parse: parseAppsRestartArgs,
  });
}

async function handleAppsRedeploy(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsRedeployArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_redeploy', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = await readPersistedResourceValue(normalized.envelope.resourceUri);
  const resourceRecord = asRecord(resourceValue) ?? {};
  const responseRecord = asRecord(resourceRecord.response) ?? {};
  const requestRecord = asRecord(resourceRecord.request) ?? {};
  const semantic = deriveProgressSemantic(resourceValue);
  const payload = {
    ok: semantic.ok ?? normalized.envelope.ok,
    status: semantic.ok === true ? 'success' : semantic.ok === false ? 'error' : normalized.envelope.ok ? 'pending' : normalizeRuntimeCommandStatus(normalized, 'pending'),
    ...(normalized.envelope.error && semantic.ok !== true ? { error: normalized.envelope.error } : {}),
    operation: 'redeploy',
    appname: parsed.appname,
    force: parsed.rawArgs.force === true,
    global: parsed.rawArgs.global === true,
    timeoutMs: asOptionalNumberValue(parsed.rawArgs.timeoutMs) ?? asOptionalNumberValue(requestRecord.timeoutMs),
    httpStatus: asOptionalNumberValue(summary.status) ?? asOptionalNumberValue(responseRecord.status),
    semanticSource: semantic.source,
    semanticMessage: semantic.message,
    eventCount: semantic.eventCount,
    events: semantic.events,
    lastEvent: semantic.lastEvent,
    resourceUri: normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsRedeployPretty(payload));
  }

  if (semantic.ok === false) return EXIT_CODE_FLUX_FAILURE;
  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsRedeployComponent(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsRedeployComponentArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_redeploy_component', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = await readPersistedResourceValue(normalized.envelope.resourceUri);
  const resourceRecord = asRecord(resourceValue) ?? {};
  const responseRecord = asRecord(resourceRecord.response) ?? {};
  const requestRecord = asRecord(resourceRecord.request) ?? {};
  const semantic = deriveProgressSemantic(resourceValue);
  const payload = {
    ok: semantic.ok ?? normalized.envelope.ok,
    status: semantic.ok === true ? 'success' : semantic.ok === false ? 'error' : normalized.envelope.ok ? 'pending' : normalizeRuntimeCommandStatus(normalized, 'pending'),
    ...(normalized.envelope.error && semantic.ok !== true ? { error: normalized.envelope.error } : {}),
    operation: 'redeploy-component',
    appname: parsed.appname,
    component: parsed.component,
    force: parsed.rawArgs.force === true,
    timeoutMs: asOptionalNumberValue(parsed.rawArgs.timeoutMs) ?? asOptionalNumberValue(requestRecord.timeoutMs),
    httpStatus: asOptionalNumberValue(summary.status) ?? asOptionalNumberValue(responseRecord.status),
    semanticSource: semantic.source,
    semanticMessage: semantic.message,
    eventCount: semantic.eventCount,
    events: semantic.events,
    lastEvent: semantic.lastEvent,
    resourceUri: normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsRedeployPretty(payload));
  }

  if (semantic.ok === false) return EXIT_CODE_FLUX_FAILURE;
  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsTestInstall(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsTestInstallArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_test_install', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = await readPersistedResourceValue(normalized.envelope.resourceUri);
  const semantic = deriveTestInstallSemantic(resourceValue);
  const semanticOk = semantic.ok ?? normalized.envelope.ok;
  const resourceRecord = asRecord(resourceValue) ?? {};
  const responseRecord = asRecord(resourceRecord.response) ?? {};
  const requestRecord = asRecord(resourceRecord.request) ?? {};
  const status = semantic.ok === true
    ? 'success'
    : semantic.ok === false
      ? 'error'
      : normalizeRuntimeCommandStatus(normalized, 'pending');
  const payload = {
    ...summary,
    ok: semanticOk,
    status,
    ...(normalized.envelope.error && semantic.ok !== true ? { error: normalized.envelope.error } : {}),
    hash: parsed.hash,
    httpStatus: asOptionalNumberValue(summary.httpStatus) ?? asOptionalNumberValue(responseRecord.status),
    timeoutMs: asOptionalNumberValue(summary.timeoutMs) ?? asOptionalNumberValue(requestRecord.timeoutMs),
    semanticSource: semantic.source,
    eventCount: semantic.eventCount,
    events: semantic.events,
    lastEvent: semantic.lastEvent,
    semanticMessage: semantic.message,
    resourceUri: normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsTestInstallPretty(payload));
  }

  if (semanticOk) return EXIT_CODE_SUCCESS;
  return exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsGenerateSpec(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsGenerateSpecArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_generate_app_spec_v8', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not generate app spec.', io, parsed.outputMode);
  }

  const result = asRecord(normalized.envelope.result) ?? {};
  const spec = unwrapSpecCandidate(result);
  if (!spec) {
    return emitFailure('flux', 'Generated spec response did not include a JSON object spec.', io, parsed.outputMode);
  }

  const identity = extractAppIdentityFromSpec(spec);
  const artifactUri = await persistJsonArtifactResource(
    'apps/generated-spec',
    `Generated spec ${identity.appname ?? 'app'}`,
    { spec },
    'Generated v8 app spec artifact'
  );

  const payload = {
    ok: true,
    status: 'ok',
    appname: identity.appname,
    owner: identity.owner,
    specVersion: asOptionalIntegerValue(spec.version),
    spec,
    resourceUri: artifactUri,
    nextActions: [
      { command: 'flux apps verify-registration', arguments: { specResourceUri: artifactUri } },
      { command: 'flux apps plan-registration', arguments: { specResourceUri: artifactUri } },
    ],
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsGenerateSpecPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsVerifySpec(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  options: {
    validation: 'registration' | 'update';
    toolName: 'flux_apps_verify_registration_spec' | 'flux_apps_verify_update_spec';
    parse: (args: string[]) => AppsSpecInputParseResult;
  }
): Promise<number> {
  const parsed = options.parse(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let spec: Record<string, unknown>;
  try {
    spec = await loadSpecFromSource(parsed.specSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(options.toolName, { spec }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(
      normalized.failureKind ?? 'flux',
      normalized.envelope.error ?? `Could not verify ${options.validation} spec.`,
      io,
      parsed.outputMode
    );
  }

  const verifiedSpec = unwrapSpecCandidate(normalized.envelope.result);
  if (!verifiedSpec) {
    return emitFailure('flux', 'Verification response did not include a JSON object spec.', io, parsed.outputMode);
  }

  const identity = extractAppIdentityFromSpec(verifiedSpec);
  const artifactUri = await persistJsonArtifactResource(
    `apps/verify-${options.validation}`,
    `${options.validation} spec ${identity.appname ?? 'app'}`,
    { validation: options.validation, spec: verifiedSpec },
    `Verified ${options.validation} spec artifact`
  );

  const payload = {
    ok: true,
    status: 'ok',
    validation: options.validation,
    appname: identity.appname,
    owner: identity.owner,
    spec: verifiedSpec,
    resourceUri: artifactUri,
    nextActions: options.validation === 'registration'
      ? [{ command: 'flux apps plan-registration', arguments: { specResourceUri: artifactUri } }]
      : [{ command: 'flux apps plan-update', arguments: { specResourceUri: artifactUri } }],
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsSpecValidationPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsVerifyRegistration(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsVerifySpec(args, io, toolRuntime, mode, {
    validation: 'registration',
    toolName: 'flux_apps_verify_registration_spec',
    parse: parseAppsVerifyRegistrationArgs,
  });
}

async function handleAppsVerifyUpdate(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsVerifySpec(args, io, toolRuntime, mode, {
    validation: 'update',
    toolName: 'flux_apps_verify_update_spec',
    parse: parseAppsVerifyUpdateArgs,
  });
}

async function handleAppsCalculatePrice(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsCalculatePriceArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let spec: Record<string, unknown>;
  try {
    spec = await loadSpecFromSource(parsed.specSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_calculate_price', { spec }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not calculate app price.', io, parsed.outputMode);
  }

  const identity = extractAppIdentityFromSpec(spec);
  const price = normalizePriceShape(normalized.envelope.result);
  if (!price) {
    return emitFailure('flux', 'Price response did not include a JSON object.', io, parsed.outputMode);
  }

  const artifactUri = await persistJsonArtifactResource(
    'apps/calculate-price',
    `Price ${identity.appname ?? 'app'}`,
    { spec, price },
    'Calculated price artifact'
  );

  const payload = {
    ok: true,
    status: 'ok',
    appname: identity.appname,
    owner: identity.owner,
    fluxAmount: extractFluxAmountFromValue(price),
    price,
    resourceUri: artifactUri,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsPricePretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsPlanCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  options: {
    toolName: 'flux_apps_plan_registration' | 'flux_apps_plan_update';
    parse: (args: string[]) => AppsSpecInputParseResult;
  }
): Promise<number> {
  const parsed = options.parse(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let spec: Record<string, unknown>;
  try {
    spec = await loadSpecFromSource(parsed.specSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const toolArgs: Record<string, unknown> = {
    spec,
    ...(typeof parsed.rawArgs.timestamp === 'number' ? { timestamp: parsed.rawArgs.timestamp } : {}),
    ...(typeof parsed.rawArgs.typeVersion === 'number' ? { typeVersion: parsed.rawArgs.typeVersion } : {}),
  };

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(options.toolName, toolArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not build app plan.', io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceUri = asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri ?? null;
  const resourceRecord = normalizePlanningResourceRecord(await readPersistedResourceValue(resourceUri));
  const identity = extractAppIdentityFromSpec(spec);
  const payload = {
    ...summary,
    ok: true,
    status: normalizePlanningStatus(summary, true),
    appname: asOptionalStringValue(summary.appname) ?? identity.appname,
    owner: asOptionalStringValue(summary.owner) ?? identity.owner,
    verifiedSpec: unwrapSpecCandidate(resourceRecord.verified),
    price: normalizePriceShape(resourceRecord.price),
    payload: normalizeSpecValue(resourceRecord.payload),
    payment: normalizeSpecValue(summary.payment) ?? normalizeSpecValue(resourceRecord.payment),
    resourceUri,
    messageToSignResourceUri: asOptionalStringValue(summary.messageToSignResourceUri)
      ?? asOptionalStringValue(resourceRecord.messageToSignResourceUri),
    nextActions: normalizeNextActionItems(summary.nextActions ?? resourceRecord.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsPlanPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAppsPlanRegistration(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsPlanCommand(args, io, toolRuntime, mode, {
    toolName: 'flux_apps_plan_registration',
    parse: parseAppsPlanRegistrationArgs,
  });
}

async function handleAppsPlanUpdate(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsPlanCommand(args, io, toolRuntime, mode, {
    toolName: 'flux_apps_plan_update',
    parse: parseAppsPlanUpdateArgs,
  });
}

async function handleAppsSubmissionCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  options: {
    operation: 'register' | 'update';
    toolName: 'flux_apps_register' | 'flux_apps_update';
    parse: (args: string[]) => AppsSubmissionParseResult;
  }
): Promise<number> {
  const parsed = options.parse(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let submission;
  try {
    submission = await loadSubmissionMaterial(parsed.submissionSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const timestamp = typeof parsed.rawArgs.timestamp === 'number' ? parsed.rawArgs.timestamp : submission.timestamp;
  if (!timestamp) {
    return emitFailure('validation', 'A timestamp is required; provide one directly or use a plan resource that includes it.', io, parsed.outputMode);
  }

  const typeVersion = typeof parsed.rawArgs.typeVersion === 'number' ? parsed.rawArgs.typeVersion : submission.typeVersion ?? 1;
  const verifyFirst = typeof parsed.rawArgs.verifyFirst === 'boolean'
    ? parsed.rawArgs.verifyFirst
    : submission.source === 'plan'
      ? false
      : true;
  const includePayment = options.operation === 'update'
    ? typeof parsed.rawArgs.includePayment === 'boolean'
      ? parsed.rawArgs.includePayment
      : true
    : undefined;

  const toolArgs: Record<string, unknown> = {
    spec: submission.spec,
    signature: parsed.rawArgs.signature,
    timestamp,
    typeVersion,
    verifyFirst,
    ...(options.operation === 'update' && includePayment !== undefined ? { includePayment } : {}),
  };

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(options.toolName, toolArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const identity = extractAppIdentityFromSpec(submission.spec);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: asOptionalStringValue(summary.status)
      ?? (normalized.envelope.ok ? 'submitted' : failureStatus(normalized.failureKind ?? 'flux')),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    operation: options.operation,
    appname: asOptionalStringValue(summary.appname) ?? identity.appname,
    owner: asOptionalStringValue(summary.owner) ?? identity.owner,
    hash: asOptionalStringValue(summary.hash),
    timestamp,
    typeVersion,
    verifyFirst,
    ...(options.operation === 'update' ? { includePayment: includePayment === true } : {}),
    requiresAuth: submission.requiresAuth,
    source: submission.source,
    planResourceUri: submission.planResourceUri,
    messageToSignResourceUri: asOptionalStringValue(summary.messageToSignResourceUri) ?? submission.messageToSignResourceUri,
    payment: normalizeSpecValue(summary.payment) ?? submission.payment,
    verifiedSpec: submission.verifiedSpec,
    resourceUri: asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsSubmissionPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsRegister(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsSubmissionCommand(args, io, toolRuntime, mode, {
    operation: 'register',
    toolName: 'flux_apps_register',
    parse: parseAppsRegisterArgs,
  });
}

async function handleAppsUpdate(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsSubmissionCommand(args, io, toolRuntime, mode, {
    operation: 'update',
    toolName: 'flux_apps_update',
    parse: parseAppsUpdateArgs,
  });
}

async function handleAppsVerifyFlowCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  options: {
    operation: 'register-and-verify' | 'update-and-verify';
    toolName: 'flux_apps_register_and_verify' | 'flux_apps_update_and_verify';
    parse: (args: string[]) => AppsSubmissionParseResult;
  }
): Promise<number> {
  const parsed = options.parse(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let submission;
  try {
    submission = await loadSubmissionMaterial(parsed.submissionSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const timestamp = typeof parsed.rawArgs.timestamp === 'number' ? parsed.rawArgs.timestamp : submission.timestamp;
  if (!timestamp) {
    return emitFailure('validation', 'A timestamp is required; provide one directly or use a plan resource that includes it.', io, parsed.outputMode);
  }

  const typeVersion = typeof parsed.rawArgs.typeVersion === 'number' ? parsed.rawArgs.typeVersion : submission.typeVersion ?? 1;
  const verifyFirst = typeof parsed.rawArgs.verifyFirst === 'boolean'
    ? parsed.rawArgs.verifyFirst
    : submission.source === 'plan'
      ? false
      : true;

  const toolArgs: Record<string, unknown> = {
    spec: submission.spec,
    signature: parsed.rawArgs.signature,
    timestamp,
    typeVersion,
    verifyFirst,
    ...(typeof parsed.rawArgs.attempts === 'number' ? { attempts: parsed.rawArgs.attempts } : {}),
    ...(typeof parsed.rawArgs.intervalMs === 'number' ? { intervalMs: parsed.rawArgs.intervalMs } : {}),
    ...(typeof parsed.rawArgs.pollTimeoutMs === 'number' ? { pollTimeoutMs: parsed.rawArgs.pollTimeoutMs } : {}),
    ...(typeof parsed.rawArgs.verifyGlobal === 'boolean' ? { verifyGlobal: parsed.rawArgs.verifyGlobal } : {}),
    ...(typeof parsed.rawArgs.poll === 'boolean' ? { poll: parsed.rawArgs.poll } : {}),
    ...(parsed.rawArgs.confirm === true ? { confirm: true } : {}),
    ...(options.operation === 'update-and-verify' && typeof parsed.rawArgs.includePayment === 'boolean'
      ? { includePayment: parsed.rawArgs.includePayment }
      : {}),
  };

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(options.toolName, toolArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const identity = extractAppIdentityFromSpec(submission.spec);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: asOptionalStringValue(summary.status)
      ?? (normalized.envelope.ok ? 'submitted' : failureStatus(normalized.failureKind ?? 'flux')),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    operation: options.operation,
    appname: asOptionalStringValue(summary.appname) ?? identity.appname,
    owner: asOptionalStringValue(summary.owner) ?? identity.owner,
    timestamp,
    typeVersion,
    verifyFirst,
    requiresAuth: submission.requiresAuth,
    source: submission.source,
    planResourceUri: submission.planResourceUri,
    messageToSignResourceUri: asOptionalStringValue(summary.messageToSignResourceUri) ?? submission.messageToSignResourceUri,
    payment: normalizeSpecValue(summary.payment) ?? submission.payment,
    resourceUri: asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsSubmissionPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsRegisterAndVerify(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsVerifyFlowCommand(args, io, toolRuntime, mode, {
    operation: 'register-and-verify',
    toolName: 'flux_apps_register_and_verify',
    parse: parseAppsRegisterAndVerifyArgs,
  });
}

async function handleAppsUpdateAndVerify(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAppsVerifyFlowCommand(args, io, toolRuntime, mode, {
    operation: 'update-and-verify',
    toolName: 'flux_apps_update_and_verify',
    parse: parseAppsUpdateAndVerifyArgs,
  });
}

async function handleAppsWaitPropagation(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsWaitPropagationArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_wait_for_propagation', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const temporaryPresent = summary.temporaryPresent === true;
  const permanentPresent = summary.permanentPresent === true;
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok
      ? normalizePropagationState(temporaryPresent, permanentPresent)
      : failureStatus(normalized.failureKind ?? 'flux'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    operation: 'wait-propagation',
    hash: parsed.hash,
    attempts: typeof parsed.rawArgs.attempts === 'number' ? parsed.rawArgs.attempts : 10,
    intervalMs: typeof parsed.rawArgs.intervalMs === 'number' ? parsed.rawArgs.intervalMs : 3000,
    timeoutMs: typeof parsed.rawArgs.timeoutMs === 'number' ? parsed.rawArgs.timeoutMs : null,
    resourceUri: asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsPropagationPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsMessages(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsMessagesArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  const kind = typeof parsed.rawArgs.kind === 'string' && parsed.rawArgs.kind.trim()
    ? parsed.rawArgs.kind.trim()
    : 'both';
  if (!['temporary', 'permanent', 'both'].includes(kind)) {
    return emitFailure('validation', '--kind must be one of temporary, permanent, or both.', io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_get_messages', { hash: parsed.hash, kind }, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceValue = await readPersistedResourceValue(asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri);
  const resourceRecord = asRecord(resourceValue) ?? {};
  const temporaryValue = kind === 'permanent' ? null : resourceRecord.temporary ?? resourceValue;
  const permanentValue = kind === 'temporary' ? null : resourceRecord.permanent ?? resourceValue;
  const temporaryCount = kind === 'permanent' ? 0 : countFluxPayloadItems(temporaryValue);
  const permanentCount = kind === 'temporary' ? 0 : countFluxPayloadItems(permanentValue);
  const temporaryPresent = temporaryCount > 0;
  const permanentPresent = permanentCount > 0;
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status: normalized.envelope.ok
      ? normalizePropagationState(temporaryPresent, permanentPresent)
      : failureStatus(normalized.failureKind ?? 'flux'),
    ...(normalized.envelope.error ? { error: normalized.envelope.error } : {}),
    operation: 'messages',
    hash: parsed.hash,
    kind,
    temporaryPresent,
    permanentPresent,
    temporaryCount,
    permanentCount,
    resourceUri: asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri,
    nextActions: normalizeNextActionItems(summary.nextActions ?? normalized.envelope.nextActions),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsPropagationPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsPlanRenew(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAppsPlanRenewArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  let spec: Record<string, unknown> | undefined;
  if (parsed.specSource) {
    try {
      spec = await loadSpecFromSource(parsed.specSource);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
    }
  }

  const toolArgs: Record<string, unknown> = {
    appname: parsed.appname,
    ...(typeof parsed.rawArgs.owner === 'string' ? { owner: parsed.rawArgs.owner } : {}),
    ...(typeof parsed.rawArgs.weeks === 'number' ? { weeks: parsed.rawArgs.weeks } : {}),
    ...(typeof parsed.rawArgs.blocksToAdd === 'number' ? { blocksToAdd: parsed.rawArgs.blocksToAdd } : {}),
    ...(typeof parsed.rawArgs.mode === 'string' ? { mode: parsed.rawArgs.mode } : {}),
    ...(typeof parsed.rawArgs.blocksPerWeek === 'number' ? { blocksPerWeek: parsed.rawArgs.blocksPerWeek } : {}),
    ...(typeof parsed.rawArgs.secondsPerBlock === 'number' ? { secondsPerBlock: parsed.rawArgs.secondsPerBlock } : {}),
    ...(typeof parsed.rawArgs.timestamp === 'number' ? { timestamp: parsed.rawArgs.timestamp } : {}),
    ...(typeof parsed.rawArgs.typeVersion === 'number' ? { typeVersion: parsed.rawArgs.typeVersion } : {}),
    ...(spec ? { spec } : {}),
  };

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_apps_plan_renew', toolArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const summary = asRecord(normalized.envelope.result) ?? {};
  const resourceUri = asOptionalStringValue(summary.resourceUri) ?? normalized.envelope.resourceUri ?? null;
  const resourceRecord = normalizePlanningResourceRecord(await readPersistedResourceValue(resourceUri));
  const status = normalizePlanningStatus(summary, normalized.envelope.ok);
  const payload = {
    ...summary,
    ok: normalized.envelope.ok,
    status,
    appname: asOptionalStringValue(summary.appname) ?? parsed.appname,
    ownerFilter: asOptionalStringValue(summary.ownerFilter) ?? asOptionalStringValue(parsed.rawArgs.owner),
    reference: asRecord(summary.reference) ?? asRecord(resourceRecord.reference) ?? {},
    policy: asRecord(summary.policy) ?? asRecord(resourceRecord.policy) ?? {},
    expireComputed: asOptionalIntegerValue(summary.expireComputed) ?? asOptionalIntegerValue(resourceRecord.expireComputed),
    specSource: asOptionalStringValue(summary.specSource) ?? asOptionalStringValue(resourceRecord.specSource),
    specWarning: asOptionalStringValue(summary.specWarning) ?? asOptionalStringValue(resourceRecord.specWarning),
    isEnterprise: summary.isEnterprise === true || resourceRecord.isEnterprise === true,
    payment: normalizeSpecValue(summary.payment) ?? normalizeSpecValue(resourceRecord.payment),
    verifiedSpec: unwrapSpecCandidate(resourceRecord.verified),
    price: normalizePriceShape(resourceRecord.price),
    payload: normalizeSpecValue(resourceRecord.payload),
    updatedSpec: normalizeSpecValue(resourceRecord.updatedSpec),
    resourceUri,
    messageToSignResourceUri: asOptionalStringValue(summary.messageToSignResourceUri)
      ?? asOptionalStringValue(resourceRecord.messageToSignResourceUri),
    nextActions: normalizeNextActionItems(summary.nextActions ?? resourceRecord.nextActions ?? normalized.envelope.nextActions),
    ...(
      normalized.envelope.error && normalized.envelope.error !== 'Flux tool execution failed.' && status !== 'planning_incomplete'
        ? { error: normalized.envelope.error }
        : {}
    ),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAppsRenewPlanPretty(payload));
  }

  return normalized.envelope.ok ? EXIT_CODE_SUCCESS : exitCodeForFailureKind(normalized.failureKind ?? 'flux');
}

async function handleAppsCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderAppsHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list-running':
      return handleAppsListRunning(rest, io, toolRuntime, mode);
    case 'list-all':
      return handleAppsListAll(rest, io, toolRuntime, mode);
    case 'list-global':
      return handleAppsListGlobal(rest, io, toolRuntime, mode);
    case 'global-status':
      return handleAppsGlobalStatus(rest, io, toolRuntime, mode);
    case 'troubleshoot':
      return handleAppsTroubleshoot(rest, io, toolRuntime, mode);
    case 'health':
      return handleAppsHealth(rest, io, toolRuntime, mode);
    case 'logs':
      return handleAppsLogs(rest, io, toolRuntime, mode);
    case 'inspect':
      return handleAppsInspect(rest, io, toolRuntime, mode);
    case 'stats':
      return handleAppsStats(rest, io, toolRuntime, mode);
    case 'top':
      return handleAppsTop(rest, io, toolRuntime, mode);
    case 'monitor':
      return handleAppsMonitor(rest, io, toolRuntime, mode);
    case 'exec':
      return handleAppsExec(rest, io, toolRuntime, mode);
    case 'start':
      return handleAppsStart(rest, io, toolRuntime, mode);
    case 'stop':
      return handleAppsStop(rest, io, toolRuntime, mode);
    case 'restart':
      return handleAppsRestart(rest, io, toolRuntime, mode);
    case 'redeploy':
      return handleAppsRedeploy(rest, io, toolRuntime, mode);
    case 'redeploy-component':
      return handleAppsRedeployComponent(rest, io, toolRuntime, mode);
    case 'generate-spec':
      return handleAppsGenerateSpec(rest, io, toolRuntime, mode);
    case 'verify-registration':
      return handleAppsVerifyRegistration(rest, io, toolRuntime, mode);
    case 'verify-update':
      return handleAppsVerifyUpdate(rest, io, toolRuntime, mode);
    case 'calculate-price':
      return handleAppsCalculatePrice(rest, io, toolRuntime, mode);
    case 'plan-registration':
      return handleAppsPlanRegistration(rest, io, toolRuntime, mode);
    case 'plan-update':
      return handleAppsPlanUpdate(rest, io, toolRuntime, mode);
    case 'register':
      return handleAppsRegister(rest, io, toolRuntime, mode);
    case 'update':
      return handleAppsUpdate(rest, io, toolRuntime, mode);
    case 'register-and-verify':
      return handleAppsRegisterAndVerify(rest, io, toolRuntime, mode);
    case 'update-and-verify':
      return handleAppsUpdateAndVerify(rest, io, toolRuntime, mode);
    case 'wait-propagation':
      return handleAppsWaitPropagation(rest, io, toolRuntime, mode);
    case 'messages':
      return handleAppsMessages(rest, io, toolRuntime, mode);
    case 'plan-renew':
      return handleAppsPlanRenew(rest, io, toolRuntime, mode);
    case 'by-zelid':
      return handleAppsByZelid(rest, io, toolRuntime, mode);
    case 'get-spec':
      return handleAppsGetSpec(rest, io, toolRuntime, mode);
    case 'get-spec-full':
      return handleAppsGetSpecFull(rest, io, toolRuntime, mode);
    case 'get-owner':
      return handleAppsGetOwner(rest, io, toolRuntime, mode);
    case 'get-public-key':
      return handleAppsGetPublicKey(rest, io, toolRuntime, mode);
    case 'registration-information':
      return handleAppsRegistrationInformation(rest, io, toolRuntime, mode);
    case 'deployment-information':
      return handleAppsDeploymentInformation(rest, io, toolRuntime, mode);
    case 'test-install':
      return handleAppsTestInstall(rest, io, toolRuntime, mode);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown apps subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleEnterpriseKeyClear(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure(
      'validation',
      `Unexpected arguments for \`flux enterprise-key clear\`: ${parsed.positional.join(' ')}`,
      io,
      parsed.outputMode
    );
  }

  await clearPersistedEnterpriseKeyState();
  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action: 'clear',
    target: 'enterprise-key',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `Cleared persisted enterprise key for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

async function handleEnterpriseKeyCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderEnterpriseKeyHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'clear':
      return handleEnterpriseKeyClear(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown enterprise-key subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleStateCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderStateHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'show':
      return handleStateShow(rest, io);
    case 'clear':
      return handleStateClear(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown state subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

function renderProfileListPretty(summary: PersistedProfilesSummary): string {
  return [
    `Persisted CLI profiles (${summary.profiles.length})`,
    `Active profile: ${summary.activeProfile}`,
    ...summary.profiles.map((profile) => {
      const parts = [
        `${profile.active ? '*' : '-'} ${profile.name}`,
        `baseUrl=${profile.baseUrl ?? '<unset>'}`,
        `auth=${profile.auth.present ? 'present' : 'not set'}`,
        `enterpriseKey=${profile.enterpriseKey.present ? 'present' : 'not set'}`,
        `fluxDrive=${profile.fluxDriveMwsBaseUrl}`,
        `httpDefaults=${profile.httpDefaults.timeoutMs}/${profile.httpDefaults.retryCount}/${profile.httpDefaults.retryBackoffMs}`,
      ];

      return parts.join(' · ');
    }),
  ].join('\n');
}

async function handleProfileList(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const summary = await listPersistedProfiles();
  const payload = {
    ok: true,
    status: 'ok',
    count: summary.profiles.length,
    activeProfile: summary.activeProfile,
    profiles: summary.profiles,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderProfileListPretty(summary));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleProfileCreate(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile create <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile create\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await createPersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'create',
      activeProfile: result.activeProfile,
      profile: result.profile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(io.stdout, `Created profile ${result.profile.name}. Active profile remains ${result.activeProfile}.`);
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileUse(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile use <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile use\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await usePersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'use',
      activeProfile: result.activeProfile,
      profile: result.profile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(io.stdout, `Switched active profile to ${result.activeProfile}.`);
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileDelete(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile delete <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile delete\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await deletePersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'delete',
      deletedProfile: result.deletedProfile,
      deletedWasActive: result.deletedWasActive,
      activeProfile: result.activeProfile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(
        io.stdout,
        result.deletedWasActive
          ? `Deleted active profile ${result.deletedProfile}; switched to ${result.activeProfile}.`
          : `Deleted profile ${result.deletedProfile}. Active profile remains ${result.activeProfile}.`
      );
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderProfileHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return handleProfileList(rest, io);
    case 'create':
      return handleProfileCreate(rest, io);
    case 'use':
      return handleProfileUse(rest, io);
    case 'delete':
      return handleProfileDelete(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown profile subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleToolCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderToolHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return handleToolList(rest, io, toolRuntime);
    case 'call':
      return handleToolCall(rest, io, toolRuntime, mode);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown tool subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const effectivePersistedStateMode = options.persistedStateMode ?? (options.toolRuntime ? 'off' : 'auto');

  if (argv.length === 0 || isHelpFlag(argv[0])) {
    writeLine(io.stdout, renderHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [command] = argv;

  try {
    switch (command) {
      case 'tool': {
        const toolRuntime = options.toolRuntime ?? (await getDefaultToolRuntime());
        return await handleToolCommand(argv.slice(1), io, toolRuntime, effectivePersistedStateMode);
      }
      case 'resource':
        return await handleResourceCommand(argv.slice(1), io);
      case 'state':
        return await handleStateCommand(argv.slice(1), io);
      case 'profile':
        return await handleProfileCommand(argv.slice(1), io);
      case 'auth':
        return await handleAuthCommand(
          argv.slice(1),
          io,
          options.toolRuntime ?? (await getDefaultToolRuntime()),
          effectivePersistedStateMode
        );
      case 'apps':
        return await handleAppsCommand(
          argv.slice(1),
          io,
          options.toolRuntime ?? (await getDefaultToolRuntime()),
          effectivePersistedStateMode
        );
      case 'node':
        return await handleNodeCommand(
          argv.slice(1),
          io,
          options.toolRuntime ?? (await getDefaultToolRuntime()),
          effectivePersistedStateMode
        );
      case 'enterprise-key':
        return await handleEnterpriseKeyCommand(argv.slice(1), io);
      default:
        writeLine(io.stderr, `Unknown command: ${command}`);
        writeLine(io.stderr, '');
        writeLine(io.stderr, renderHelp());
        return EXIT_CODE_VALIDATION;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(io.stderr, `flux failed: ${message}`);
    return EXIT_CODE_FLUX_FAILURE;
  }
}
