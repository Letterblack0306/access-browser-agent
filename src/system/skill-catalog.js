'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class SkillCatalog {
  constructor(directory, options = {}) {
    const requestedDirectory = String(directory || '').trim();
    if (!requestedDirectory) throw new Error('Skill catalog directory is required.');
    this.directory = path.resolve(requestedDirectory);
    this.readFile = options.readFile || fs.readFile;
    this.readdir = options.readdir || fs.readdir;
    this.maxFileBytes = Math.max(1024, Number(options.maxFileBytes) || 32 * 1024);
  }

  async list() {
    let entries;
    try { entries = await this.readdir(this.directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error(`Could not list skill catalog: ${error.message}`); }
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const file = path.join(this.directory, entry.name, 'SKILL.md');
      try { skills.push(parseSkill(await this.readFile(file, 'utf8'), entry.name, this.maxFileBytes)); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read skill ${entry.name}: ${error.message}`); }
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Reads the full skill document (frontmatter plus body) for injection into agent context. */
  async readSkill(name) {
    const skillName = String(name || '').trim();
    if (!skillName || !/^[a-zA-Z0-9._-]+$/u.test(skillName)) throw new Error('Invalid skill name.');
    const file = path.join(this.directory, skillName, 'SKILL.md');
    let text;
    try { text = await this.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Could not read skill ${skillName}: ${error.message}`); }
    return parseSkillDocument(text, skillName, this.maxFileBytes);
  }
}

function parseSkill(content, fallbackName, maxFileBytes = 32 * 1024) {
  const text = String(content || '').slice(0, maxFileBytes);
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/.exec(text);
  const frontmatter = match?.[1] || '';
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() || String(fallbackName || '').trim();
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() || 'No description declared.';
  if (!name) throw new Error('Skill name is required.');
  return Object.freeze({ name, description });
}

/** Parses a full SKILL.md document including its body content (for agent context injection). */
function parseSkillDocument(content, fallbackName, maxFileBytes = 32 * 1024) {
  const text = String(content || '').slice(0, maxFileBytes);
  const { name, description } = parseSkill(text, fallbackName, maxFileBytes);
  const bodyMatch = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/.exec(text);
  const body = bodyMatch ? text.slice(bodyMatch[0].length).trim() : text.trim();
  return Object.freeze({ name, description, content: body });
}

module.exports = { SkillCatalog, parseSkill, parseSkillDocument };
