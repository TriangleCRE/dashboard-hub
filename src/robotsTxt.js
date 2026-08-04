// Served un-gated at /robots.txt. This is defense-in-depth / politeness —
// the passcode gate is what actually enforces privacy — but it also keeps
// the site out of search indexes and known AI-scraper datasets.
const ROBOTS_TXT = `User-agent: *
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Bytespider
Disallow: /
`;

module.exports = { ROBOTS_TXT };
