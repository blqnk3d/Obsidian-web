import { searchAndJump } from '../ui/editor.js';

function scrollToTarget(target) {
  const preview = document.getElementById('preview');
  if (!preview) return;

  const candidates = preview.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, th, td, blockquote');
  for (const el of candidates) {
    if (el.textContent.trim().toLowerCase() === target.trim().toLowerCase()) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--accent)';
      setTimeout(() => el.style.outline = '', 1500);
      return;
    }
  }
  for (const el of candidates) {
    const text = el.textContent.trim().toLowerCase();
    if (text.includes(target.trim().toLowerCase())) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--accent)';
      setTimeout(() => el.style.outline = '', 1500);
      return;
    }
  }
}

export async function postprocess(container) {
  container.querySelectorAll('a[data-wikilink]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-wikilink');
      searchAndJump(`[[${target}]]`);
      scrollToTarget(target);
    });
  });

  renderCallouts(container);
  await renderLatex(container);
  await renderMermaid(container);
}

function renderCallouts(container) {
  container.querySelectorAll('span.callout-marker').forEach(span => {
    const type = span.getAttribute('data-callout-type');
    const title = span.getAttribute('data-callout-title') || type;
    const blockquote = span.closest('blockquote');
    if (!blockquote) {
      span.remove();
      return;
    }

    const calloutDiv = document.createElement('div');
    calloutDiv.className = `callout callout-${type}`;

    const header = document.createElement('div');
    header.className = 'callout-header';
    header.textContent = title;
    calloutDiv.appendChild(header);

    const body = document.createElement('div');
    body.className = 'callout-body';

    const parentP = span.parentNode;
    span.remove();

    if (parentP && parentP.tagName === 'P') {
      while (parentP.firstChild && parentP.firstChild.tagName === 'BR') {
        parentP.removeChild(parentP.firstChild);
      }
      if (parentP.textContent.trim() === '' && parentP.children.length === 0) {
        parentP.remove();
      }
    }

    while (blockquote.firstChild) {
      body.appendChild(blockquote.firstChild);
    }

    calloutDiv.appendChild(body);
    blockquote.parentNode.replaceChild(calloutDiv, blockquote);
  });
}

let katex = null;
async function renderLatex(container) {
  if (!katex) {
    try {
      const mod = await import('katex');
      katex = mod.default || mod;
    } catch (e) {
      console.error('KaTeX load failed:', e);
      return;
    }
  }

  // Display math: $$...$$ — process at innerHTML level to
  // reconstruct math that was split across <br> by breaks:true
  const blocks = container.querySelectorAll('p, div:not(.katex-display), li, td, th, blockquote, .callout-body');
  for (const block of blocks) {
    if (block.closest('pre, code, .katex, .katex-display')) continue;
    if (!block.textContent || !block.textContent.includes('$$')) continue;

    block.innerHTML = block.innerHTML.replace(
      /\$\$([\s\S]*?)\$\$/g,
      (match, inner) => {
        const math = inner.replace(/<br\s*\/?>/gi, '\n').trim();
        if (!math) return match;
        try {
          return katex.renderToString(math, { displayMode: true, throwOnError: false });
        } catch {
          return match;
        }
      }
    );
  }

  // Inline math: $...$ — process text nodes, skip KaTeX-rendered areas
  const textNodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentNode.closest?.('.katex, .katex-display, pre, code, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);
  let n;
  while ((n = walker.nextNode()) !== null) {
    textNodes.push(n);
  }

  for (const node of textNodes) {
    const text = node.nodeValue;
    if (!text || !text.includes('$')) continue;

    if (text.match(/\$[^$]/)) {
      const parts = text.split(/(\$[^$]+?\$)/);
      const fragment = document.createDocumentFragment();
      let replaced = false;
      for (const part of parts) {
        const m = part.match(/^\$([^$]+?)\$$/);
        if (m) {
          try {
            const html = katex.renderToString(m[1], { displayMode: false, throwOnError: false });
            const span = document.createElement('span');
            span.innerHTML = html;
            fragment.appendChild(span);
            replaced = true;
          } catch {
            fragment.appendChild(document.createTextNode(part));
          }
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      }
      if (replaced) {
        node.parentNode.replaceChild(fragment, node);
      }
    }
  }
}

let mermaidInitialized = false;
async function renderMermaid(container) {
  const blocks = container.querySelectorAll('code.language-mermaid');
  if (!blocks.length) return;

  let mermaid;
  try {
    mermaid = await import('mermaid');
  } catch {
    return;
  }

  if (!mermaidInitialized) {
    mermaid.default.initialize({ startOnLoad: false, theme: 'dark' });
    mermaidInitialized = true;
  }

  for (const code of blocks) {
    const pre = code.closest('pre');
    if (!pre) continue;

    const graphId = 'mermaid-' + Math.random().toString(36).slice(2, 9);
    const svg = pre.ownerDocument.createElement('div');
    svg.className = 'mermaid';

    try {
      const { svg: svgText } = await mermaid.default.render(graphId, code.textContent);
      svg.innerHTML = svgText;
      pre.parentNode.replaceChild(svg, pre);
    } catch (e) {
      console.warn('Mermaid error:', e);
    }
  }
}
