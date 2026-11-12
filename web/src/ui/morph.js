/**
 * Patch `el`'s children to match `html` in place. Live data re-renders the
 * panels every few seconds; morphing (rather than replacing innerHTML) keeps
 * element identity, so clicks, hover, focus and running animations survive.
 */
export function morph(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}

function patchChildren(from, to) {
  const a = from.childNodes;
  const b = to.childNodes;
  let i = 0;
  for (; i < b.length; i++) {
    const next = b[i];
    const cur = a[i];
    if (!cur) {
      from.appendChild(next.cloneNode(true));
    } else if (cur.nodeType !== next.nodeType || cur.nodeName !== next.nodeName) {
      from.replaceChild(next.cloneNode(true), cur);
    } else if (cur.nodeType === Node.TEXT_NODE || cur.nodeType === Node.COMMENT_NODE) {
      if (cur.nodeValue !== next.nodeValue) cur.nodeValue = next.nodeValue;
    } else {
      patchAttributes(cur, next);
      patchChildren(cur, next);
    }
  }
  while (a.length > b.length) from.removeChild(from.lastChild);
}

function patchAttributes(cur, next) {
  for (const { name } of [...cur.attributes]) {
    if (!next.hasAttribute(name)) cur.removeAttribute(name);
  }
  for (const { name, value } of next.attributes) {
    if (cur.getAttribute(name) !== value) cur.setAttribute(name, value);
  }
}
