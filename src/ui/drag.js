export function makeDraggable(win, header, onDragStart) {
  if (!win || !header) return;
  let dragging = false;
  let startX, startY, origLeft, origTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-controls')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = win.offsetLeft;
    origTop = win.offsetTop;
    win.style.left = origLeft + 'px';
    win.style.right = 'auto';
    win.style.top = origTop + 'px';
    win.style.transition = 'none';
    if (onDragStart) onDragStart();
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newLeft = origLeft + dx;
    let newTop = origTop + dy;
    newLeft = Math.max(-win.offsetWidth + 60, Math.min(newLeft, window.innerWidth - 60));
    newTop = Math.max(40, Math.min(newTop, window.innerHeight - 60));
    win.style.left = newLeft + 'px';
    win.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    win.style.transition = '';
  });
}
