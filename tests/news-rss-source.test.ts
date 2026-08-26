import { describe, it, expect } from "vitest";
import { NewsRssKnowledgeSource } from "../src/knowledge/news-rss-source.js";

function res(body: { json?: unknown; text?: string }, ok = true): any {
  return { ok, json: async () => body.json, text: async () => body.text ?? "" };
}
function mockFetch(handler: (url: string) => any): typeof fetch {
  return (async (url: string) => handler(url)) as unknown as typeof fetch;
}

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>BBC</title>
<item><title>新闻甲</title><link>https://example.com/a</link><description><![CDATA[甲的描述 &amp; <b>bold</b> 结尾]]></description><pubDate>Wed, 26 Aug 2026 10:00:00 GMT</pubDate></item>
<item><title>新闻乙</title><link>https://example.com/b</link><description>乙的描述</description><pubDate>Tue, 25 Aug 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>原子丙</title><link href="https://example.com/c" rel="alternate"/><summary>丙的描述</summary><updated>2026-08-27T00:00:00Z</updated></entry>
</feed>`;

const FEEDS = ["https://feed.test/rss", "https://feed.test/atom"];

describe("NewsRssKnowledgeSource — top mode (req_l05 live news)", () => {
  it("parses RSS + Atom, strips HTML/entities, ranks by recency, real URL", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("atom")) return res({ text: ATOM });
      return res({ text: RSS });
    });
    const src = new NewsRssKnowledgeSource({ feeds: FEEDS, mode: "top", fetchImpl });
    const c = await src.rankedCandidates();
    // 丙(Aug27 newest) > 甲(Aug26) > 乙(Aug25) → recency desc
    expect(c.map((x) => x.title)).toEqual(["原子丙", "新闻甲", "新闻乙"]);
    expect(c[0].id.startsWith("news-")).toBe(true);
    expect(c[0].sourceUrl).toBe("https://example.com/c");
  });

  it("strips HTML tags and decodes entities in summary", async () => {
    const fetchImpl = mockFetch(() => res({ text: RSS }));
    const src = new NewsRssKnowledgeSource({ feeds: ["https://feed.test/rss"], fetchImpl });
    const c = await src.rankedCandidates();
    const jia = c.find((x) => x.title === "新闻甲")!;
    expect(jia.summary).toContain("甲的描述");
    expect(jia.summary).toContain("bold 结尾");
    expect(jia.summary).not.toContain("<b>");
    expect(jia.summary).toContain("&"); // decoded &amp;
  });

  it("skips a failing feed and still returns the rest (resilience)", async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes("atom") ? res({}, false) : res({ text: RSS }),
    );
    const src = new NewsRssKnowledgeSource({ feeds: FEEDS, fetchImpl });
    const c = await src.rankedCandidates();
    expect(c.length).toBe(2);
  });

  it("returns [] when every feed fails (tracker learns nothing that day)", async () => {
    const fetchImpl = mockFetch(() => res({}, false));
    const src = new NewsRssKnowledgeSource({ feeds: FEEDS, fetchImpl });
    expect(await src.rankedCandidates()).toEqual([]);
  });

  it("defaultMode is top; top mode keeps recency order", async () => {
    const src = new NewsRssKnowledgeSource({ feeds: ["https://feed.test/rss"], fetchImpl: mockFetch(() => res({ text: RSS })) });
    expect(src.defaultMode).toBe("top");
    const c = await src.rankedCandidates();
    expect(c[0].title).toBe("新闻甲"); // Aug 26 > Aug 25
  });

  it("random mode still returns all items (shuffled)", async () => {
    const fetchImpl = mockFetch(() => res({ text: RSS }));
    const src = new NewsRssKnowledgeSource({ feeds: ["https://feed.test/rss"], mode: "random", fetchImpl });
    const c = await src.rankedCandidates();
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.rank >= 1)).toBe(true);
  });

  it("dedupes identical URLs across feeds", async () => {
    const fetchImpl = mockFetch(() => res({ text: RSS }));
    const src = new NewsRssKnowledgeSource({ feeds: ["https://feed.test/rss", "https://feed.test/rss2"], fetchImpl });
    const c = await src.rankedCandidates();
    expect(c.length).toBe(2);
  });
});
