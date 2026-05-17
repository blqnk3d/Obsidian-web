let container = null;
let toasts = [];
const MAX_VISIBLE = 5;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => removeToast(el));
  el.appendChild(closeBtn);

  getContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));

  const id = setTimeout(() => removeToast(el), duration);
  el.dataset.timerId = id;

  toasts.push(el);
  if (toasts.length > MAX_VISIBLE) {
    const oldest = toasts.shift();
    removeToast(oldest);
  }

  return el;
}

function removeToast(el) {
  if (el.dataset.removing) return;
  el.dataset.removing = 'true';
  clearTimeout(Number(el.dataset.timerId));
  el.classList.remove('toast-visible');
  el.addEventListener('transitionend', () => {
    el.remove();
    toasts = toasts.filter(t => t !== el);
  }, { once: true });
  setTimeout(() => {
    if (el.parentNode) {
      el.remove();
      toasts = toasts.filter(t => t !== el);
    }
  }, 300);
}
