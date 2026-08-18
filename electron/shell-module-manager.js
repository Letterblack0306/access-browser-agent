'use strict';

const RAIL_ICON_PATHS = Object.freeze({
  home: ['M4 11.5 12 4l8 7.5v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'],
  agent: ['M12 3v4M8.5 5.5l2 2M15.5 5.5l-2 2', 'M5 12a7 7 0 1 0 14 0v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', 'M9 14h.01M15 14h.01'],
  'live-agent': ['M12 3a9 9 0 1 0 9 9', 'M8 12h4l2-3 2 6 2-3h2', 'M12 3v2'],
  review: ['M5 4h14v16H5z', 'M8 9h8M8 13h8M8 17h5'],
  'workspace-sync': ['M4 8h12l-3-3', 'M20 16H8l3 3', 'M16 5v3M8 19v-3'],
  'project-audit': ['M6 3h9l3 3v15H6z', 'M15 3v4h4', 'M9 13h5M9 17h3', 'M15.5 15.5 19 19'],
  editor: ['M5 4h10l4 4v12H5z', 'M15 4v5h5', 'M8 13h8M8 17h6'],
  skills: ['M12 3 4.5 7.2 12 11.4l7.5-4.2z', 'M4.5 12 12 16.2 19.5 12', 'M4.5 16.8 12 21l7.5-4.2'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M4.8 14.2 3 12l1.8-2.2-.1-2.8 2.7-.9L9 3.8 12 5l3-1.2 1.6 2.3 2.7.9-.1 2.8L21 12l-1.8 2.2.1 2.8-2.7.9L15 20.2 12 19l-3 1.2-1.6-2.3-2.7-.9z'],
  activity: ['M4 12h3l2-6 4 12 2-6h5'],
  git: ['M7 5v9a3 3 0 0 0 3 3h7', 'M7 5a2 2 0 1 0 0 .01M17 17a2 2 0 1 0 0 .01M10 8a2 2 0 1 0 0 .01'],
  logs: ['M4 5h16v14H4z', 'm8 9 3 3-3 3', 'M13 15h3']
});

function railGroup(module) {
  if (['home', 'agent', 'live-agent'].includes(module.id)) return 'workflow';
  if (['editor', 'git', 'workspace-sync'].includes(module.id)) return 'workspace';
  if (['review', 'logs'].includes(module.id)) return 'evidence';
  if (['skills', 'settings'].includes(module.id)) return 'configuration';
  return 'blocked';
}

function railIcon(module) {
  const paths = RAIL_ICON_PATHS[module.id] || ['M5 5h14v14H5z'];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach(value => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', value);
    svg.append(path);
  });
  return svg;
}

class ShellModuleManager {
  constructor({ workbench, rail, modules, renderContent }) {
    this.workbench = workbench;
    this.rail = rail;
    this.modules = [...modules].sort((a, b) => a.order - b.order);
    this.renderContent = renderContent;
    this.elements = new Map();
  }

  mount() {
    this.slots = {
      left: this.workbench.querySelector('[data-shell-slot="left"]'),
      right: this.workbench.querySelector('[data-shell-slot="right"]'),
      rightAgent: this.workbench.querySelector('[data-shell-slot="right-agent"]'),
      bottom: this.workbench.querySelector('[data-shell-slot="bottom"]'),
      stash: this.workbench.querySelector('[data-shell-slot="stash"]')
    };

    if (Object.values(this.slots).some(slot => !slot)) {
      throw new Error('Permanent workbench shell slots are missing.');
    }

    this.renderRail();
    this.wireResizers();

    for (const module of this.modules) {
      const element = document.createElement('section');
      element.className = `module module-${module.id}`;
      element.dataset.moduleId = module.id;
      element.setAttribute('aria-label', module.title);
      element.innerHTML = this.renderContent(module);
      this.elements.set(module.id, element);

      if (module.placement === 'left') this.slots.left.append(element);
      else if (module.placement === 'right-agent') this.slots.rightAgent.append(element);
      else if (module.placement === 'bottom') this.slots.bottom.append(element);
      else this.slots.stash.append(element);
    }

    this.reset();
  }

  renderRail() {
    const items = this.modules.filter(module =>
      module.visible &&
      module.placement === 'right'
    );

    const railItems = [];
    let previousGroup = null;
    for (const module of items) {
      const group = railGroup(module);
      if (previousGroup && group !== previousGroup) {
        const divider = document.createElement('div');
        divider.className = 'rail-divider';
        divider.setAttribute('role', 'separator');
        railItems.push(divider);
      }
      const button = document.createElement('button');
      button.className = 'rail-tab';
      button.type = 'button';
      button.dataset.window = module.id;
      button.title = module.title;
      button.setAttribute('aria-label', module.title);
      button.setAttribute('aria-current', 'false');

      const icon = document.createElement('span');
      icon.className = 'rail-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.append(railIcon(module));

      button.append(icon);
      button.addEventListener('click', () => this.select(module.id));
      railItems.push(button);
      previousGroup = group;
    }
    this.rail.replaceChildren(...railItems);
  }

  select(id) {
    const module = this.modules.find(item => item.id === id && item.visible);
    if (!module) return false;

    if (module.placement !== 'right') return false;
    this.slots.right.replaceChildren(this.elements.get(module.id));
    this.updateRail(module.id);
    return true;
  }

  reset() {
    const module = this.modules.find(item => item.visible && item.placement === 'right');

    if (!module) throw new Error('One visible primary module is required.');
    this.slots.right.replaceChildren(this.elements.get(module.id));
    this.updateRail(module.id);
  }

  updateRail(activeId) {
    this.rail.querySelectorAll('.rail-tab').forEach(tab => {
      const active = tab.dataset.window === activeId;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  wireResizers() {
    const left = this.workbench.querySelector('[data-shell-resizer="left"]');
    const bottom = this.workbench.querySelector('[data-shell-resizer="bottom"]');

    this.bindResizer(left, 'left');
    this.bindResizer(bottom, 'bottom');
  }

  resizeBy(axis, delta) {
    const bounds = this.workbench.getBoundingClientRect();
    const property = axis === 'left' ? '--left-pane-width' : '--bottom-pane-height';
    const fallback = axis === 'left' ? 300 : 250;
    const current = Number.parseFloat(getComputedStyle(this.workbench).getPropertyValue(property)) || fallback;
    const minimum = axis === 'left' ? 220 : 120;
    const rawMaximum = axis === 'left' ? bounds.width - 740 : bounds.height - 180;
    const maximum = Math.max(minimum, rawMaximum);
    const size = Math.max(minimum, Math.min(maximum, current + delta));
    this.workbench.style.setProperty(property, `${size}px`);
    window.dispatchEvent(new CustomEvent('workbench-resized'));
  }

  bindResizer(handle, axis) {
    if (!handle) return;

    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 40 : 10;
      const keyDelta = axis === 'left'
        ? (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)
        : (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
      if (!keyDelta) return;
      event.preventDefault();
      this.resizeBy(axis, keyDelta);
    });

    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);

      const move = moveEvent => {
        const bounds = this.workbench.getBoundingClientRect();
        const value = axis === 'left'
          ? moveEvent.clientX - bounds.left
          : bounds.bottom - moveEvent.clientY;
        const property = axis === 'left' ? '--left-pane-width' : '--bottom-pane-height';
        const minimum = axis === 'left' ? 220 : 120;
        const rawMaximum = axis === 'left' ? bounds.width - 740 : bounds.height - 180;
        const maximum = Math.max(minimum, rawMaximum);
        const size = Math.max(minimum, Math.min(maximum, value));
        this.workbench.style.setProperty(property, `${size}px`);
        window.dispatchEvent(new CustomEvent('workbench-resized'));
      };

      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop, { once: true });
      handle.addEventListener('pointercancel', stop, { once: true });
    });
  }
}

window.ShellModuleManager = ShellModuleManager;
