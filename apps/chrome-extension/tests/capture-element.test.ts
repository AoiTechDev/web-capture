import { afterEach, describe, expect, test } from "vitest";
import { captureElement } from "~contents/features/capture/capture-element";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("captureElement (element picker)", () => {
  test("a card containing an image, a link and text is saved as an element, not as its image", () => {
    document.body.innerHTML = `
      <div id="card"><img src="https://example.com/hero.png"><a href="/x">Read more</a><p>Pricing</p></div>`;
    const card = document.getElementById("card")!;
    const out = captureElement(card);
    expect(out.kind).toBe("element");
    expect(out).toMatchObject({ tagName: "div", target: card });
  });

  test("plain text and links are also saved as elements", () => {
    document.body.innerHTML = `<p id="p">Hello</p><a id="a" href="/x">Link</a>`;
    expect(captureElement(document.getElementById("p")!).kind).toBe("element");
    expect(captureElement(document.getElementById("a")!).kind).toBe("element");
  });

  test("a picked <img> itself keeps its original file", () => {
    document.body.innerHTML = `<img id="i" src="https://example.com/a.png" alt="A">`;
    const out = captureElement(document.getElementById("i")!);
    expect(out).toMatchObject({ kind: "image", src: "https://example.com/a.png", alt: "A" });
  });
});
