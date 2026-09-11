/* dom.js — DOM組み立ての最小ヘルパー。
   ui.js と card-render.js の両方から使うため、依存のない場所に置いている。 */

export function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text != null) n.textContent = opts.text;
  if (opts.html != null) n.innerHTML = opts.html;   // 固定文字列（SVG等）のみ
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) {
    if (v === true) n.setAttribute(k, '');
    else if (v != null && v !== false) n.setAttribute(k, String(v));
  }
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) n.addEventListener(k, v);
  // カスタムプロパティ（--i など）は setProperty でないと入らない
  if (opts.style) for (const [k, v] of Object.entries(opts.style)) {
    if (k.startsWith('--')) n.style.setProperty(k, String(v));
    else n.style[k] = v;
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
