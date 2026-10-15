import {
  decodeEntities,
  decodeHtml,
  displayDomain,
  extractPreviewMeta,
  isPrivateIp,
  previewCacheKey,
  resolveImageUrl,
} from "../chat.link-preview";

describe("chat link preview helpers", () => {
  test("extracts Google share OpenGraph tags with content-first attribute order", () => {
    const html = `<head>
      <meta content="Sandhya Cine House · Balussery, Keralam" property="og:title">
      <meta content="4.5 &#11088; · Movie theater in Balussery, Keralam" property="og:description">
      <meta content="https://dimg-pa.googleapis.com/ic/abc?x=1&amp;y=2" property="og:image">
      <meta content="www.google.com" property="og:site_name">
      <title>Ignored</title></head>`;
    expect(extractPreviewMeta(html)).toEqual({
      title: "Sandhya Cine House · Balussery, Keralam",
      description: "4.5 ⭐ · Movie theater in Balussery, Keralam",
      image: "https://dimg-pa.googleapis.com/ic/abc?x=1&y=2",
      siteName: "www.google.com",
    });
  });

  test("keeps apostrophes inside double-quoted content and falls back to twitter/title", () => {
    const html = `<title>Page title</title>
      <meta name="twitter:description" content="It's a great day">
      <meta name='twitter:image' content='/img/card.png'>`;
    const meta = extractPreviewMeta(html);
    expect(meta.title).toBe("Page title");
    expect(meta.description).toBe("It's a great day");
    expect(meta.image).toBe("/img/card.png");
  });

  test("decodes the declared charset (Google serves ISO-8859-1)", () => {
    const bytes = Buffer.from([0x41, 0xb7, 0x42]); // "A·B" in latin1
    expect(decodeHtml(bytes, "text/html; charset=ISO-8859-1")).toBe("A·B");
    expect(decodeHtml(Buffer.from("A·B", "utf8"), "text/html")).toBe("A·B");
  });

  test("decodes numeric and named entities", () => {
    expect(decodeEntities("&#x27;a&#39; &amp; &lt;b&gt; &#11088;")).toBe("'a' & <b> ⭐");
  });

  test("shows the link's own domain like Signal", () => {
    expect(displayDomain("https://share.google/hhXMVB6INwfVEw3E7")).toBe("share.google");
    expect(displayDomain("https://www.example.com/a")).toBe("example.com");
    expect(displayDomain("not a url")).toBe("");
  });

  test("blocks private, loopback, CGNAT, metadata and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::ffff:10.0.0.1", "fd00::1", "fe80::1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.183.14", "2607:f8b0:4004:800::200e", "::ffff:8.8.8.8"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  test("resolves relative images against the final page URL and rejects data URIs", () => {
    const page = new URL("https://www.google.com/knowledgegraphshares?q=1");
    expect(resolveImageUrl("/logo.png", page)?.toString()).toBe("https://www.google.com/logo.png");
    expect(resolveImageUrl("data:image/png;base64,AAA", page)).toBeNull();
    expect(resolveImageUrl("javascript:alert(1)", page)).toBeNull();
    expect(resolveImageUrl(undefined, page)).toBeNull();
  });

  test("scopes the cache key by tenant and org", () => {
    const a = previewCacheKey(5, 42, "https://x.y");
    expect(a).toMatch(/^t:5:linkpreview:42:[0-9a-f]{40}$/);
    expect(previewCacheKey(5, 43, "https://x.y")).not.toBe(a);
  });
});
