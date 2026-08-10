export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/static": "." });

  eleventyConfig.addCollection("comics", (api) =>
    api.getFilteredByGlob("src/comics/*.md").sort((a, b) => a.data.date - b.data.date)
  );

  eleventyConfig.addFilter("longDate", (d) =>
    new Date(d).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
    })
  );

  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString());

  // Deterministic per-strip "wobble" so every panel is hand-placed, not machine-placed.
  eleventyConfig.addFilter("wobble", (slug) => {
    let h = 0;
    for (const ch of String(slug)) h = (h * 31 + ch.charCodeAt(0)) % 1000;
    return (h / 1000) * 1.6 - 0.8; // degrees, -0.8..0.8
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
