# Trending Across Your Follows

## How It Works

**"Trending Across Your Follows"** is a new section that appears at the top of the digest when multiple people you follow are talking about the same thing.

### When does it show up?

- Only when 2 or more accounts in your follows tweeted about the same topic, event, or conversation in the last 24 hours
- If everyone's talking about unrelated things, it doesn't appear — no forced connections

### How does it detect shared topics?

- After fetching all tweets from your follows, the Whisperer looks across all accounts at once and asks: "Are any of these people reacting to, discussing, or referencing the same thing?"
- Strong signals: multiple people quoting the same tweet, reacting to the same news, or replying to each other
- It caps at 1-3 shared topics per digest — quality over quantity

### What does it look like?

- A highlighted box at the top of the email, before the usual per-person breakdowns
- Each shared topic gets a bold title, mentions which @handles are discussing it, and gives a 1-2 sentence summary of the collective conversation
- The individual per-person sections still appear below with full detail

### What doesn't change?

- The per-person summaries are exactly the same as before
- If only 1 person has new tweets, or no topics overlap, the digest looks identical to today
- No extra Twitter API calls — it reuses tweets already fetched

---

## Example

Based on the February 17, 2026 digest where 4 out of 5 people were all reacting to Tobi Lutke's spike in code commits, here's what the email would have looked like with this feature:

> **Bird Whisperer Digest**
> February 17, 2026
>
> ---
>
> **Trending Across Your Follows**
>
> **Tobi Lutke's Code Commits** — @tobi, @harleyf, @MParakhin, and @lulumeservey are all reacting to Tobi's massive spike in GitHub commits this year — nearly 1,000 already in 2026. The shared read: AI coding tools like Claude are putting CEOs back into builder mode, and Tobi is the poster child. @MParakhin joked that the commits are actually being offloaded to them, while @harleyf and @lulumeservey are framing it as proof that Shopify's technical edge comes from the top.
>
> ---
>
> **@tobi**
> They're tracking the rapid evolution of robotics [1] and arguing that the "context engineering" required to run a company is the perfect training ground for managing AI agents [3]. For them, being creative but easily distracted is now a superpower when you have infinite agents to handle the execution [4].
>
> They also highlighted Tobi Lutke's massive spike in code commits over the last few years [5] and shared performance updates for QMD, which now supports Node and Bun [6]. On the political side, they called out the Dutch legislature as "pathetic" after a State Secretary resigned for lying about her education [2].
>
> 6 new tweets
>
> **@harleyf**
> They're highlighting the massive spike in Tobi's coding activity at Shopify, noting how Claude is helping CEOs move from strategy meetings back into builder mode [1]. The rest of their recent activity is all about national pride, celebrating the anniversary of the Canadian flag and rallying behind "Team Canada" [2][3].
>
> 3 new tweets
>
> **@MParakhin**
> They joked that Tobi Lutke's massive spike in coding activity — nearly 1,000 commits already this year — is because he's offloading work to them, though they admit AI agents are the real driver [1]. It's a striking example of how LLMs are putting CEOs back into builder mode.
>
> 1 new tweet
>
> **@dhh**
> They're calling the new Asus ExpertBook a major win for Intel, noting it's half the weight of an M5 MacBook Pro with comparable performance [1]. For their own workflow, they've been automating their dev environment using Tmux to launch a specific three-way split for Neovim and terminal tasks [2]. They also shared a master class with Jason Fried on the 37signals philosophy, which covers building for yourself and resisting the urge to let software get bloated [3].
>
> 3 new tweets
>
> **@lulumeservey**
> They find it unsettling when people earnestly engage with AI-generated posts, viewing it as a waste of human effort [1]. Turning to your world at Shopify, they credit the company's technical edge to Tobi's hands-on "builder mode" and his massive spike in code commits [2]. They also shared Tobi's blunt correction to a critic about what it actually takes to run the company [3].
>
> 3 new tweets

Notice @dhh is the only one *not* mentioned in the trending section — their tweets were about Intel laptops, Tmux, and 37signals, which had no overlap with the Tobi thread. The feature correctly leaves them out.
