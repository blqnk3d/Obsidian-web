const CALLOUT_RE = /^\[!(\w+)\]\s*(.*)$/m;

export function calloutsPlugin(md) {
  let isCallout = false;

  const origBlockquoteOpen = md.renderer.rules.blockquote_open;
  md.renderer.rules.blockquote_open = function () {
    return '';
  };

  md.renderer.rules.blockquote_close = function () {
    return '';
  };

  md.core.ruler.push('callout_transform', function (state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== 'blockquote_open') continue;

      let contentTokens = [];
      let j = i + 1;
      let depth = 1;

      while (j < tokens.length && depth > 0) {
        if (tokens[j].type === 'blockquote_open') depth++;
        if (tokens[j].type === 'blockquote_close') depth--;
        if (depth > 0) contentTokens.push(tokens[j]);
        j++;
      }

      const inlineTok = contentTokens.find(t => t.type === 'inline');
      if (!inlineTok) continue;

      const match = inlineTok.content.match(CALLOUT_RE);
      if (!match) continue;

      const [, type, title] = match;
      const header = title || type;

      inlineTok.content = inlineTok.content.replace(CALLOUT_RE, '').replace(/^\n/, '').trim();

      const calloutOpen = new state.Token('callout_open', 'div', 1);
      calloutOpen.block = true;
      calloutOpen.meta = { type: type.toLowerCase(), header };

      const calloutClose = new state.Token('callout_close', 'div', -1);
      calloutClose.block = true;

      tokens.splice(i, j - i, calloutOpen, ...contentTokens, calloutClose);
      i += contentTokens.length + 1;
    }
  });

  md.renderer.rules.callout_open = function (tokens, idx) {
    const meta = tokens[idx].meta;
    return `<div class="callout callout-${meta.type}">
      <div class="callout-header">${md.utils.escapeHtml(meta.header)}</div>
      <div class="callout-body">`;
  };

  md.renderer.rules.callout_close = function () {
    return '</div></div>';
  };
}
