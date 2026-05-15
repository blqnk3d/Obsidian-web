export function createPromptModal({ title, labelText, inputValue, confirmText = 'Save', cancelText = 'Cancel', onConfirm, onCancel }) {
  const existing = document.querySelector('.rename-overlay');
  if (existing) return null;

  const overlay = document.createElement('div');
  overlay.className = 'rename-overlay';

  const box = document.createElement('div');
  box.className = 'rename-box';

  const label = document.createElement('div');
  label.className = 'rename-label';
  label.textContent = labelText || title;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.type = 'text';
  input.value = inputValue || '';
  input.spellcheck = false;

  const buttons = document.createElement('div');
  buttons.className = 'rename-buttons';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'rename-btn-primary';
  confirmBtn.textContent = confirmText;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'rename-btn-secondary';
  cancelBtn.textContent = cancelText;

  buttons.appendChild(confirmBtn);
  buttons.appendChild(cancelBtn);
  box.appendChild(label);
  box.appendChild(input);
  box.appendChild(buttons);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  input.focus();
  input.select();

  const cleanup = () => { overlay.remove(); };

  confirmBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (onConfirm) onConfirm(val || inputValue);
    cleanup();
  });

  cancelBtn.addEventListener('click', () => {
    if (onCancel) onCancel();
    cleanup();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
    if (e.key === 'Escape') cancelBtn.click();
  });

  return { overlay, input, confirmBtn, cancelBtn };
}
