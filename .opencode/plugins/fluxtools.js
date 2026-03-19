/**
 * Fluxtools plugin for OpenCode.ai
 *
 * Injects the using-fluxtools bootstrap skill into the system prompt.
 * Shared Fluxtools skills are discovered separately through OpenCode's native skill system.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: body };
};

const normalizePath = (p, homeDir) => {
  if (!p || typeof p !== 'string') return null;
  let normalized = p.trim();
  if (!normalized) return null;
  if (normalized.startsWith('~/')) {
    normalized = path.join(homeDir, normalized.slice(2));
  } else if (normalized === '~') {
    normalized = homeDir;
  }
  return path.resolve(normalized);
};

export const FluxtoolsPlugin = async () => {
  const homeDir = os.homedir();
  const envConfigDir = normalizePath(process.env.OPENCODE_CONFIG_DIR, homeDir);
  const configDir = envConfigDir || path.join(homeDir, '.config/opencode');
  const skillRoots = [
    path.join(configDir, 'skills', 'fluxtools'),
    path.resolve(__dirname, '../../skills'),
    path.join(homeDir, '.agents', 'skills', 'fluxtools'),
  ];

  const resolveBootstrapSkillPath = () => {
    for (const skillRoot of skillRoots) {
      const candidate = path.join(skillRoot, 'using-fluxtools', 'SKILL.md');
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  const getBootstrapContent = () => {
    const bootstrapSkillPath = resolveBootstrapSkillPath();
    if (!bootstrapSkillPath) return null;

    const fullContent = fs.readFileSync(bootstrapSkillPath, 'utf8');
    const { content } = extractAndStripFrontmatter(fullContent);

    const toolMapping = `**Tool Mapping for OpenCode:**
When Fluxtools instructions refer to shell execution, use OpenCode's native command execution with the repo-local \`flux\` CLI.

**Skills location:**
Fluxtools skills are expected at \`${configDir}/skills/fluxtools/\`
Use OpenCode's native skill system to list and load skills when needed.`;

    return `<EXTREMELY_IMPORTANT>
You have Fluxtools.

**The using-fluxtools bootstrap skill content is included below and is already active. Do not load using-fluxtools again unless the user explicitly asks.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
  };

  return {
    'experimental.chat.system.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent();
      if (bootstrap) {
        (output.system ||= []).push(bootstrap);
      }
    }
  };
};
