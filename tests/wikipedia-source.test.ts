import { describe, it, expect } from "vitest";
import { WikipediaKnowledgeSource } from "../src/knowledge/wikipedia-source.js";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";

/** Minimal Response-like object — code only touches `.ok` and `.json()`. */
function res(data: unknown, ok = true): any {
  return { ok, json: async () => data };
}

/** Mock fetch: differentiate the random API vs a summary URL by substring. */
function mockFetch(handler: (url: string) => any): typeof fetch {
  return (async (url: string) => handler(url)) as unknown as typeof fetch;
}

const SAMPLE_SUMMARY = (title: string, extract: string) => ({
  title,
  extract,
  type: "standard",
  content_urls: { desktop: { page: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}` } },
});

describe("WikipediaKnowledgeSource — top mode (req_l05 live wiki curated)", () => {
  it("fetches REAL intros live and keeps rank ascending + real citation URLs", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("page/summary/")) {
        const t = decodeURIComponent(url.split("page/summary/")[1]);
        return res(SAMPLE_SUMMARY(t, `${t} 的实时摘要来自维基百科。`));
      }
      return res({});
    });
    const src = new WikipediaKnowledgeSource({ lang: "zh", mode: "top", fetchImpl });
    const c = await src.rankedCandidates();
    expect(c.length).toBe(6);
    for (let i = 1; i < c.length; i++) expect(c[i].rank).toBeGreaterThan(c[i - 1].rank);
    expect(c[0].id).toBe("wiki-photosynthesis");
    expect(c[0].summary).toContain("实时摘要");
    expect(c[0].sourceUrl).toContain("https://zh.wikipedia.org/wiki/");
  });

  it("skips a topic whose fetch fails and still returns the rest", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("page/summary/") && decodeURIComponent(url).includes("线粒体")) {
        return res(null, false); // 500 / unreachable
      }
      if (url.includes("page/summary/")) {
        const t = decodeURIComponent(url.split("page/summary/")[1]);
        return res(SAMPLE_SUMMARY(t, `${t} ok`));
      }
      return res({});
    });
    const src = new WikipediaKnowledgeSource({ mode: "top", fetchImpl });
    const c = await src.rankedCandidates();
    expect(c.length).toBe(5);
    expect(c.find((x) => x.id === "wiki-mitochondria")).toBeUndefined();
  });

  it("returns [] when every fetch fails (tracker then learns nothing that day)", async () => {
    const fetchImpl = mockFetch(() => res(null, false));
    const src = new WikipediaKnowledgeSource({ mode: "top", fetchImpl });
    expect(await src.rankedCandidates()).toEqual([]);
  });
});

describe("WikipediaKnowledgeSource — default mode is random (dec_knowledge_mode_policy)", () => {
  it("when no mode is given, defaults to random endless discovery", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("list=random")) {
        return res({ query: { random: [{ title: "量子纠缠" }] } });
      }
      if (url.includes("page/summary/")) {
        const t = decodeURIComponent(url.split("page/summary/")[1]);
        return res(SAMPLE_SUMMARY(t, `${t} 的随机摘要。`));
      }
      return res({});
    });
    const src = new WikipediaKnowledgeSource({ fetchImpl }); // no mode → random
    expect(src.defaultMode).toBe("random");
    const c = await src.rankedCandidates();
    expect(c).toHaveLength(1);
    expect(c[0].id).toBe("wiki-量子纠缠");
    expect(c[0].summary).toContain("随机摘要");
  });

  it("StaticKnowledgeSource defaults to top (curated)", () => {
    expect(new StaticKnowledgeSource().defaultMode).toBe("top");
  });
});

describe("WikipediaKnowledgeSource — random mode (endless discovery)", () => {
  it("picks a random article and returns a single rank-1 candidate with slug id", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("list=random")) {
        return res({ query: { random: [{ title: "黑洞" }] } });
      }
      if (url.includes("page/summary/")) {
        return res(SAMPLE_SUMMARY("黑洞", "黑洞是时空的极端区域。"));
      }
      return res({});
    });
    const src = new WikipediaKnowledgeSource({ mode: "random", fetchImpl });
    const c = await src.rankedCandidates();
    expect(c).toHaveLength(1);
    expect(c[0].rank).toBe(1);
    expect(c[0].id).toBe("wiki-黑洞");
    expect(c[0].summary).toContain("时空");
  });

  it("returns [] if the random title cannot be resolved", async () => {
    const fetchImpl = mockFetch(() => res({ query: { random: [] } }));
    const src = new WikipediaKnowledgeSource({ mode: "random", fetchImpl });
    expect(await src.rankedCandidates()).toEqual([]);
  });
});
