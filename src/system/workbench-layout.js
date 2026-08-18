'use strict';

const MODULE_CONTENTS = new Set(['home', 'explorer', 'editor', 'agent', 'liveAgent', 'git', 'browser', 'activity', 'trace', 'evidence', 'changes', 'review', 'modules', 'settings', 'skills', 'index', 'terminal', 'workspaceSync', 'projectAudit', 'task-state']);
const PLACEMENTS = new Set(['left', 'right', 'right-agent', 'bottom', 'drawer']);

function parseWorkbenchLayout(text) {
  let value;
  try { value = JSON.parse(String(text)); }
  catch { throw new Error('Workbench layout file must contain valid JSON.'); }
  if (!value || value.version !== 2 || !Array.isArray(value.modules) || !value.modules.length) throw new Error('Workbench layout must declare version 2 and modules.');
  const modules = value.modules.map(normalizeModule);
  if (new Set(modules.map(module => module.id)).size !== modules.length) throw new Error('Workbench module IDs must be unique.');
  if (new Set(modules.map(module => module.order)).size !== modules.length) throw new Error('Workbench module order must be unique.');
  if (modules.filter(module => module.visible && module.placement === 'left').length < 1 || modules.filter(module => module.visible && module.placement === 'right').length < 1 || modules.filter(module => module.visible && module.placement === 'bottom').length !== 1) throw new Error('Workbench contract requires visible left and primary modules, plus one visible bottom module.');
  return Object.freeze({ version: 2, modules: Object.freeze(modules.sort((left, right) => left.order - right.order).map(Object.freeze)) });
}

function normalizeModule(value) {
  const module = { id: String(value?.id || ''), content: String(value?.content || ''), placement: String(value?.placement || ''), order: Number(value?.order), visible: value?.visible === true, title: String(value?.title || ''), icon: String(value?.icon || '') };
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(module.id) || !MODULE_CONTENTS.has(module.content) || !PLACEMENTS.has(module.placement) || !Number.isInteger(module.order) || module.order < 0 || !module.title || module.title.length > 80 || module.icon.length > 8) throw new Error('Workbench module is invalid.');
  return module;
}

module.exports = { parseWorkbenchLayout, normalizeModule, MODULE_CONTENTS, PLACEMENTS };
