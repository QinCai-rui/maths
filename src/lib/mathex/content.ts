import { renderToString } from "katex";
import createDOMPurify from "dompurify";

const mathRegex = /\$\$([\s\S]+?)\$\$/g;
const placeholderRegex = /\uE000(\d+)\uE001/g;

// Question content is authored by hosts, collaborators and imported sets. It
// only needs the formatting Quill produces, never stylesheets or inline CSS.
const CONTENT_POLICY = {
  FORBID_TAGS: ["style"],
  FORBID_ATTR: ["style"]
};

export function parseStoredMath(value: string) {
  const match = /^\[scale=(0\.5|0\.75|1|1\.25|1\.5|1\.75|2\.5)\]([\s\S]*)$/.exec(value);
  return { latex: match ? match[2] : value, scale: match ? Number(match[1]) : 1 };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderKatex(value: string): string {
  const { latex, scale } = parseStoredMath(value);
  try {
    const math = renderToString(latex, { output: "mathml", throwOnError: false });
    return scale === 1 ? math : `<span style="font-size:${scale}em">${math}</span>`;
  } catch {
    return `<code class="text-destructive">${escapeHtml(latex)}</code>`;
  }
}

// Importing DOMPurify before a window exists returns the factory rather than a
// usable instance, which happens in tests that only need parseStoredMath. Build
// the instance on first render so it always binds to the browser window.
let purifier: ReturnType<typeof createDOMPurify> | null = null;

function sanitize(html: string): string {
  purifier ??= createDOMPurify(window);
  return purifier.sanitize(html, CONTENT_POLICY);
}

export function renderMath(html: string): string {
  // Protect delimited maths before the HTML parser sees it. A raw less-than
  // inside $$...$$ would otherwise start a tag and truncate the expression.
  const expressions: string[] = [];
  const protectedHtml = html.replace(mathRegex, (_, value: string) => {
    const index = expressions.push(value) - 1;
    return `\uE000${index}\uE001`;
  });
  const clean = sanitize(protectedHtml);
  const template = document.createElement("template");
  template.innerHTML = clean;

  // A formula in an attribute was protected too. Restore its original text
  // after sanitisation; setting an attribute programmatically is safe.
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (!attribute.value.includes("\uE000")) continue;
      attribute.value = attribute.value.replace(
        placeholderRegex,
        (_, index: string) => `$$${expressions[Number(index)] ?? ""}$$`
      );
    }
  }

  // Replace maths only in text nodes. Running the replacement over serialized
  // HTML after sanitisation could break out of attribute values.
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const value = node.data;
    if (!value.includes("\uE000")) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of value.matchAll(placeholderRegex)) {
      const index = match.index ?? 0;
      if (index > offset) fragment.append(document.createTextNode(value.slice(offset, index)));
      const holder = document.createElement("span");
      holder.innerHTML = renderKatex(expressions[Number(match[1])] ?? "");
      fragment.append(...holder.childNodes);
      offset = index + match[0].length;
    }
    if (offset < value.length) fragment.append(document.createTextNode(value.slice(offset)));
    node.replaceWith(fragment);
  }

  return template.innerHTML;
}

export function stripTags(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}
