import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
globals.NodeFilter = dom.window.NodeFilter;
globals.Node = dom.window.Node;
globals.Element = dom.window.Element;
globals.DOMParser = dom.window.DOMParser;
globals.NodeList = dom.window.NodeList;

const { renderMath } = await import("./content");

function parse(html: string) {
  const container = dom.window.document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("renderMath", () => {
  test("removes stylesheets and inline styles from question content", () => {
    const container = parse(
      renderMath('<p>Visible</p><style>body{display:none!important}</style><p style="color:red">Red</p>')
    );
    expect(container.querySelector("style")).toBeNull();
    expect([...container.querySelectorAll("*")].some((element) => element.hasAttribute("style"))).toBe(false);
    expect(container.textContent).toContain("Visible");
    expect(container.textContent).toContain("Red");
  });

  test("does not turn maths inside an attribute into elements", () => {
    const container = parse(renderMath('<p title="$$x$$<img src=x onerror=alert(1)>">Attribute text</p>'));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("math")).toBeNull();
    expect(
      [...container.querySelectorAll("*")].some((element) =>
        [...element.attributes].some((attribute) => attribute.name.toLowerCase().startsWith("on"))
      )
    ).toBe(false);
    expect(container.querySelector("p")?.getAttribute("title")).toContain("$$x$$");
  });

  test("renders maths in text and keeps the scale wrapper", () => {
    const container = parse(renderMath("<p>Math $$x^2$$ and $$[scale=2.5]y$$</p>"));
    expect(container.querySelector("math")).not.toBeNull();
    const scaled = [...container.querySelectorAll("span")].find((element) =>
      element.getAttribute("style")?.includes("font-size:2.5em")
    );
    expect(scaled).toBeDefined();
  });
});
