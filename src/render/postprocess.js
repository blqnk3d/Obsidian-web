export async function postprocess(container) {
  container.querySelectorAll('a[data-wikilink]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-wikilink');
      console.log(`[wikilink] navigated to: ${target}`);
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

  const textNodes = [];
  collectTextNodes(container, textNodes);

  for (const node of textNodes) {
    const text = node.nodeValue;
    if (!text || !text.includes('$')) continue;

    if (text.match(/\$\$/)) {
      const parts = text.split(/(\$\$[\s\S]+?\$\$)/);
      const fragment = document.createDocumentFragment();
      let replaced = false;
      for (const part of parts) {
        const m = part.match(/^\$\$([\s\S]+?)\$\$$/);
        if (m) {
          try {
            const html = katex.renderToString(m[1], { displayMode: true, throwOnError: false });
            const span = document.createElement('span');
            span.innerHTML = html;
            fragment.appendChild(span);
            replaced = true;
          } catch (e) {
            fragment.appendChild(document.createTextNode(part));
          }
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      }
      if (replaced) {
        node.parentNode.replaceChild(fragment, node);
      }
    } else if (text.match(/\$[^$]/)) {
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
          } catch (e) {
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

function collectTextNodes(root, result) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode()) !== null) {
    result.push(node);
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
