import { expect, test } from "vitest";

test("happy-dom provides a DOM with computed styles", () => {
  document.body.innerHTML = `<div id="x" style="color: rgb(255, 0, 0)">hi</div>`;
  const el = document.getElementById("x")!;
  expect(getComputedStyle(el).color).toBe("rgb(255, 0, 0)");
});
