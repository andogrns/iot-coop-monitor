// Shared UI helpers (DOM only; CSP-safe: no innerHTML, no inline styles in markup).
//
//   el(tag, className?, text?)                 -> element with optional class and textContent
//   notice(text, kind = 'info')                -> toast; kind: 'info' | 'success' | 'warn' | 'error'.
//                                                 info/success/warn auto-dismiss after ~6 s, errors stay until
//                                                 dismissed. notice('') clears every toast.
//   confirmDialog({title, body, confirmLabel, cancelLabel, tone}) -> Promise<boolean>
//                                                 native modal <dialog>; Esc / Cancel / backdrop -> false.
//                                                 tone 'danger' styles the confirm button red and focuses Cancel.
//   banner({tone, title, text, actionLabel, onAction}) -> <div class="banner …"> (tone: danger|warn|info)
//   emptyState(title, help?)                   -> <div class="empty-state">
//   badge(text, tone, title?)                  -> <span class="badge tone">
//   setRelativeTime(element, value, format)    -> keeps element text ticking every second;
//                                                 format(relative, absolute) builds the text, title shows absolute.
//   setClock(nowFn)                            -> clock used by relative times (server-anchored in app.js)
import { formatDateTime, relativeTime } from './format.js?v=0242141ec619';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// ---- Toasts ------------------------------------------------------------------------------
const TOAST_MS = 6000, MAX_TOASTS = 4;
let stack, politeRegion, alertRegion;
function toastRegions() {
  if (stack) return;
  stack = el('div', 'toast-stack');
  politeRegion = el('div', 'toast-region'); politeRegion.setAttribute('aria-live', 'polite');
  alertRegion = el('div', 'toast-region'); alertRegion.setAttribute('aria-live', 'assertive');
  stack.append(alertRegion, politeRegion);
  document.body.append(stack);
}
function dismiss(toast) { clearTimeout(toast._timer); toast.remove(); }

export function notice(text, kind = 'info') {
  toastRegions();
  if (!text) { for (const toast of stack.querySelectorAll('.toast')) dismiss(toast); return; }
  const tone = ['success', 'warn', 'error'].includes(kind) ? kind : 'info';
  const region = tone === 'error' ? alertRegion : politeRegion;
  // Repeated messages (e.g. a failing poll every few seconds) refresh the existing toast.
  const existing = [...region.querySelectorAll('.toast')].find(t => t.dataset.text === text && t.dataset.tone === tone);
  const toast = existing ?? el('div', `toast ${tone}`);
  if (!existing) {
    toast.dataset.text = text; toast.dataset.tone = tone;
    const close = el('button', 'toast-close quiet small', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Dismiss message');
    close.addEventListener('click', () => dismiss(toast));
    toast.append(el('p', 'toast-text', text), close);
    region.append(toast);
    const all = stack.querySelectorAll('.toast');
    if (all.length > MAX_TOASTS) dismiss(all[0] === toast ? all[1] : all[0]);
  }
  clearTimeout(toast._timer);
  if (tone !== 'error') toast._timer = setTimeout(() => dismiss(toast), TOAST_MS);
}

// ---- Confirm dialog ------------------------------------------------------------------------
export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary' } = {}) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'dialog'), form = el('form');
    form.method = 'dialog';
    const heading = el('h2', 'dialog-title', title), id = 'dialog-' + Math.random().toString(36).slice(2);
    heading.id = id + '-title'; dialog.setAttribute('aria-labelledby', heading.id);
    const content = el('div', 'dialog-body');
    content.id = id + '-body'; dialog.setAttribute('aria-describedby', content.id);
    for (const part of [].concat(body)) content.append(typeof part === 'string' ? el('p', '', part) : part);
    const actions = el('div', 'dialog-actions');
    const cancel = el('button', 'quiet', cancelLabel), confirm = el('button', tone === 'danger' ? 'danger' : 'primary', confirmLabel);
    cancel.value = 'cancel'; confirm.value = 'confirm';
    actions.append(cancel, confirm);
    form.append(heading, content, actions);
    dialog.append(form);
    // Clicking the backdrop (outside the form box) cancels.
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close('cancel'); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'confirm'); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    (tone === 'danger' ? cancel : confirm).focus();
  });
}

// ---- Small builders ------------------------------------------------------------------------
export function badge(text, tone = 'muted', title) {
  const node = el('span', `badge ${tone}`, text);
  if (title) node.title = title;
  return node;
}

export function banner({ tone = 'info', title, text, actionLabel, onAction }) {
  const node = el('div', `banner ${tone}`);
  node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  const body = el('div', 'banner-body');
  if (title) body.append(el('p', 'banner-title', title));
  if (text) body.append(el('p', 'banner-text', text));
  node.append(el('span', 'banner-icon', tone === 'info' ? 'i' : '!'), body);
  node.firstChild.setAttribute('aria-hidden', 'true');
  if (actionLabel && onAction) {
    const action = el('button', 'small', actionLabel);
    action.type = 'button';
    action.addEventListener('click', onAction);
    node.append(action);
  }
  return node;
}

export function emptyState(title, help) {
  const node = el('div', 'empty-state');
  node.append(el('p', 'empty-state-title', title));
  if (help) node.append(el('p', 'empty-state-help', help));
  return node;
}

// ---- Ticking relative times ----------------------------------------------------------------
let clock = () => Date.now(), ticker = null;
const live = new Map();
export function setClock(nowFn) { clock = nowFn; }
function paint(element, { value, format }) {
  const text = format(relativeTime(value, clock()), formatDateTime(value));
  if (element.textContent !== text) element.textContent = text;
}
export function setRelativeTime(element, value, format = relative => relative) {
  if (value === null || value === undefined) { live.delete(element); return; }
  const entry = { value, format };
  live.set(element, entry);
  element.title = formatDateTime(value);
  paint(element, entry);
  ticker ??= setInterval(() => {
    for (const [node, item] of live) {
      if (!node.isConnected) live.delete(node); else if (!document.hidden) paint(node, item);
    }
  }, 1000);
}
export function clearRelativeTime(element) { live.delete(element); element.removeAttribute('title'); }
