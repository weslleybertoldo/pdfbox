import { describe, expect, it } from "vitest";
import { isAllowedHref } from "./sanitize";

describe("isAllowedHref", () => {
  it.each(["https://fabd.org.br", "http://x.com/a?b=1", "mailto:a@b.com", "tel:+5582999", "#_Toc123", "#"])(
    "permite %s",
    (h) => expect(isAllowedHref(h)).toBe(true),
  );

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "file:///sdcard/x",
    "data:text/html,<b>",
    "intent://x",
    "content://x",
    "foo",
    "",
  ])("bloqueia %s", (h) => expect(isAllowedHref(h)).toBe(false));
});
