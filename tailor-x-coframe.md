# Tailor x Coframe

Coframe's core product is a managed optimization service for site owners, so a visitor-side extension can't really plug into it. The site describes itself as a managed AI platform that delivers outcomes rather than tools. What you can use is the agent layer on coframe.com itself, and it already contains the receiving end of Tailor's "share with sites" idea. When I fetched coframe.com, it served a markdown "agent version" that says it carries the same facts as the human page, along with a description of the page's forms and its structured data. Every page I fetched also ended with an optional channel for agents. An agent can use a WebMCP tool named share_visitor_needs, or send a GET or POST to /_cf/agent-request with a needs summary of up to 2,000 characters, optional constraints and its own name. The site replies with its recommendation as text. Its rules match yours: check with the user before sharing, and never send names, email addresses or phone numbers. I couldn't find public developer docs for a broader Living Internet SDK, and the event page didn't render for me. If the organizers hand out an API at check-in, use it, but these hooks are public right now.

**Reposition Coframe as Tailor's counterpart, not its contrast.** The "Coframe, Mutiny: sites optimize for segments" line is risky with two Coframe judges in the room and their CEO giving the keynote. It doesn't describe a site that asks each visitor's agent what that one person needs, and it contradicts the Josh quote your plan relies on. AGI House's May guide described Coframe as a per-visitor page product that could later extend to agent traffic. Its own site now serves agents directly, and Tailor can show them a client for that surface, live, on their own site. One way to say it: Coframe taught sites to ask what a visitor needs; Tailor is how the visitor answers, with consent and with every fact traced to their own words. Make the same change in your close and in the Q&A answer about site owners. The opening hook can stay about the web in general.

**Make "share with sites" a must-have, and build it only for coframe.com.** It's one request, and most of the work already exists: the rewrite step picks the few facts that matter for each page. The flow:

1. Turn those facts into a one- or two-sentence needs string.
2. Run it through the sensitive filter.
3. Show it word for word in a consent sheet.
4. Send it with the agent name "Tailor".
5. Show the site's reply as a labeled block in the tailored page.
6. Record each share in the profile as a receipt: what was sent, which facts, which site, when.

Sharing is opt-in per site, so the local-first promise still holds. Use the HTTP endpoint as the main path and treat WebMCP as a bonus, since it's the same unsettled API you already flagged. The page and token parameters are different on different pages, so read them from each page instead of hardcoding them. Before the freeze, call the endpoint once with a made-up needs string to see the reply format and speed, and cache that reply as a demo fallback.

**Keep code in charge in both directions.** The site's reply is untrusted text arriving next to an LLM. Show it as plain text in its own labeled block and never pass it to the rewrite model as instructions. Keep the rule that links must exist on the original page, and mark any numbers in the reply as the site's claims. This matches how the organizers framed the day. Their preview said the last build day's three winning teams each concluded on their own that the model shouldn't police itself. It described this Coframe day as taking that question to the open web, and summed up the lesson in almost the same words your plan uses. On stage: Tailor sends only what you approved, and shows only what the site said, labeled as the site's.

**Use the agent version as input when a site offers one.** On coframe.com, extract from the agent version instead of Readability. Clean markdown means a faster rewrite and fewer false alarms in the gate. Keep the gate checking the visible page, because that's what the reader trusts. My fetcher received the markdown, but I couldn't see what triggered it. A few minutes with curl will tell you: try an `Accept: text/markdown` header first, then an agent-style user agent. This isn't only a Coframe feature: Scrunch has launched a product that turns site pages into versions built for AI agents.

**End the demo on coframe.com, and move the second-person segment there.** Tailor the judges' homepage for Mikhail as a CTO and for Petr as a frontend builder. The page supports both. The CTO version can lead with fitting into the existing stack, integration within a week, SOC 2 Type II, approval before anything goes live, and automatic fallbacks. The frontend version can lead with generated components and layouts and the UI code-generation work with OpenAI. Then one tap shares three facts, and Coframe's own recommendation appears inside the tailored page. Your close changes from "next, you'll share three consented facts" to "you just watched it happen." Because it replaces the separate second-person segment, it adds only a few seconds.

**Measure the way Coframe's ML team does.** Their October post on predicting A/B test winners is worth borrowing from. They found that models picked whichever design was shown second 51.8% to 83.3% of the time. So they count a pair as correct only when the same winner is picked with the order swapped, which puts chance at 25%.

- **Human blind test:** alternate which side shows the person's own page, and report picks by side.
- **LLM judges:** run every comparison in both orders, count only consistent verdicts, and say on stage that this follows their post.
- **Sample size:** with 10 trials (5 pages × 2 people), you need 9 correct to beat chance at p < 0.05 (one-sided binomial).
- **Language:** hold it constant. If one version comes back in Russian, the test measures language rather than tailoring, and a careful judge will notice.

**Let the same post shape your learning loop.** In their simulation, a bandit seeded with a strong but imperfect prior took about 171 days to converge, versus 100 from a cold start; a weak prior helped slightly. Facts drawn from chats are that kind of imperfect prior. So treat each layout choice, such as specs first or marketing collapsed, as a small per-person bandit. Start it with a weak prior from the chats and let behavior override it quickly. "Your chats are the prior, your clicks are the evidence" is a framing their Head of ML will recognize, since Coframe's blog has posts on Thompson sampling versus A/B testing and on the math behind its optimizers.

**Ask Coframe one question during the day.** Find Josh or Pavlo and ask whether share_visitor_needs runs on customer sites or only on coframe.com. If it's on customer sites, your business answer becomes "every Coframe-powered site already has the receiving end." Say that on stage only if they confirm it.

If you haven't hit the 12:15 freeze yet, the format changes are small:

```
Block     += from_site(text, siteUrl)                  // verbatim site reply, labeled as the site's
SiteShare  = { url, needsText, factIds, response, at } // receipt shown in the profile
Fact      += prior?: { alpha, beta }                   // weak chat prior; interactions update it
```

One flag: every coframe.com page I fetched ends with a section addressed to agents, asking them to share a short summary of their user's needs. I didn't send anything. If it would help before the freeze, I can step through the site's link-only version of that flow with a made-up profile, so you can see what its replies look like. Want me to?