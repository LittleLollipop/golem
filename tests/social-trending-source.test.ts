import { describe, it, expect } from "vitest";
import { SocialTrendingKnowledgeSource } from "../src/knowledge/social-trending-source.js";

function res(body: { json?: unknown; text?: string }, ok = true): any {
  return { ok, json: async () => body.json, text: async () => body.text ?? "" };
}
function mockFetch(handler: (url: string) => any): typeof fetch {
  return (async (url: string) => handler(url)) as unknown as typeof fetch;
}

const HN = {
  hits: [
    { objectID: "1", title: "Show HN: foo", url: "https://foo.dev", points: 120, num_comments: 30, author: "alice" },
    { objectID: "2", title: "Ask HN: bar", points: 50, num_comments: 10, author: "bob" },
  ],
};

describe("SocialTrendingKnowledgeSource — top mode (req_l05 live social)", () => {
  it("maps HN front-page hits to candidates with meta + real citation", async () => {
    const fetchImpl = mockFetch(() => res({ json: HN }));
    const src = new SocialTrendingKnowledgeSource({ fetchImpl });
    const c = await src.rankedCandidates();
    expect(c).toHaveLength(2);
    expect(c[0].id).toBe("social-hn-1");
    expect(c[0].title).toBe("Show HN: foo");
    expect(c[0].summary).toContain("120 分");
    expect(c[0].summary).toContain("30 评论");
    expect(c[0].summary).toContain("@alice");
    expect(c[0].sourceUrl).toBe("https://foo.dev");
    // hit #2 has no url → falls back to HN item page
    expect(c[1].sourceUrl).toBe("https://news.ycombinator.com/item?id=2");
    expect(c[1].source).toBe("Hacker News");
  });

  it("defaultMode is top", () => {
    expect(new SocialTrendingKnowledgeSource().defaultMode).toBe("top");
  });

  it("returns [] when fetch fails (tracker learns nothing that day)", async () => {
    const fetchImpl = mockFetch(() => res({}, false));
    const src = new SocialTrendingKnowledgeSource({ fetchImpl });
    expect(await src.rankedCandidates()).toEqual([]);
  });

  it("random mode returns the same items, reshuffled", async () => {
    const fetchImpl = mockFetch(() => res({ json: HN }));
    const src = new SocialTrendingKnowledgeSource({ mode: "random", fetchImpl });
    const c = await src.rankedCandidates();
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.id).sort()).toEqual(["social-hn-1", "social-hn-2"]);
  });
});
