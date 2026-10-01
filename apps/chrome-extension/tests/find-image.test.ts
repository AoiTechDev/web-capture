import { afterEach, describe, expect, test } from "vitest";
import {
  largestSrcsetUrl,
  originalUrl,
  pickImageFromStack,
} from "~contents/features/capture/find-image";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("largestSrcsetUrl", () => {
  test("picks the biggest w descriptor", () => {
    expect(largestSrcsetUrl("a.jpg 236w, b.jpg 736w, c.jpg 474w")).toBe("b.jpg");
  });

  test("picks the biggest x descriptor and treats none as 1x", () => {
    expect(largestSrcsetUrl("a.jpg, b.jpg 2x")).toBe("b.jpg");
    expect(largestSrcsetUrl("a.jpg")).toBe("a.jpg");
  });

  test("empty srcset has no candidate", () => {
    expect(largestSrcsetUrl("")).toBeNull();
  });
});

describe("originalUrl", () => {
  test("rewrites Pinterest's resized path to /originals/", () => {
    expect(originalUrl("https://i.pinimg.com/236x/ab/cd/ef/hash.jpg")).toBe(
      "https://i.pinimg.com/originals/ab/cd/ef/hash.jpg"
    );
    expect(originalUrl("https://i.pinimg.com/75x75_RS/ab/cd/hash.jpg")).toBe(
      "https://i.pinimg.com/originals/ab/cd/hash.jpg"
    );
  });

  test("leaves other URLs alone", () => {
    expect(originalUrl("https://example.com/236x/a.jpg")).toBe("https://example.com/236x/a.jpg");
  });
});

describe("pickImageFromStack", () => {
  test("looks through an overlay and link on top of the image", () => {
    document.body.innerHTML = `
      <a id="link" href="/pin"><div id="overlay"></div><img id="img" src="https://example.com/a.png" alt="A"></a>`;
    const stack = ["overlay", "img", "link"].map((id) => document.getElementById(id)!);
    const hit = pickImageFromStack(stack);
    expect(hit?.element.id).toBe("img");
    expect(hit).toMatchObject({ src: "https://example.com/a.png", alt: "A" });
  });

  test("prefers the Pinterest original and keeps the displayed file as a fallback", () => {
    document.body.innerHTML = `<img id="img" src="https://i.pinimg.com/236x/ab/cd/h.jpg">`;
    const hit = pickImageFromStack([document.getElementById("img")!]);
    expect(hit?.src).toBe("https://i.pinimg.com/originals/ab/cd/h.jpg");
    expect(hit?.fallbackSrcs).toEqual(["https://i.pinimg.com/236x/ab/cd/h.jpg"]);
  });

  test("uses the largest srcset candidate", () => {
    document.body.innerHTML = `<img id="img" src="https://e.com/s.jpg" srcset="https://e.com/s.jpg 400w, https://e.com/l.jpg 1600w">`;
    const hit = pickImageFromStack([document.getElementById("img")!]);
    expect(hit?.src).toBe("https://e.com/l.jpg");
    expect(hit?.fallbackSrcs).toContain("https://e.com/s.jpg");
  });

  test("a CSS background image counts, but not on <body>", () => {
    document.body.innerHTML = `<div id="d" style="background-image:url('https://e.com/bg.jpg')"></div>`;
    document.body.style.backgroundImage = "url('https://e.com/page.jpg')";
    const d = document.getElementById("d")!;
    expect(pickImageFromStack([d, document.body])?.src).toBe("https://e.com/bg.jpg");
    expect(pickImageFromStack([document.body])).toBeNull();
  });

  test("plain elements and blob: images are not images", () => {
    document.body.innerHTML = `<div id="d"></div><img id="b" src="blob:https://e.com/x">`;
    const stack = ["d", "b"].map((id) => document.getElementById(id)!);
    expect(pickImageFromStack(stack)).toBeNull();
  });

  test("a gradient background is not an image", () => {
    document.body.innerHTML = `<div id="d" style="background-image:linear-gradient(red, blue)"></div>`;
    expect(pickImageFromStack([document.getElementById("d")!])).toBeNull();
  });
});
