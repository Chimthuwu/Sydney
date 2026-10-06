# docs/CONTENT_POLICY_REVIEW.md — Content-policy review checklist

> **What this is.** The TASK-088 design note in `TODO.md` (2026-09-26) records an
> approved *direction* — R18+ club presentation, including topless adult
> performers at the Happy Hogs / Billy Jeans venues — that is deliberately not
> implemented pending a policy review. This checklist is that review: the gate
> between "approved direction" and "cleared to implement."
>
> **How to use it.** Every `[ ]` needs an owner and a written answer before the
> design note is updated with a final decision. Nothing gets merged before the
> decision is recorded — and note §2.1: **in this repo, `git push` to `origin/main`
> *is* the deploy**, so "merge" and "publish" are the same event.
>
> **Scope boundary, regardless of outcome.** This review covers passive visual
> presentation only (what the venue renders). Interactive systems that map player
> input onto NPC bodies (the proposed "Contact-Rig") are out of scope for this
> review and remain unimplemented whatever the answer here.
>
> **Not legal advice.** §4 items are research pointers to be confirmed with
> counsel, not conclusions.

---

## 0. Decision record — fill in first

- [ ] Reviewer(s) and review date: ____
- [ ] Human decision: **approve / deny / modify** — record in the TASK-088 design note in `TODO.md` with the date and this file's hash/commit
- [ ] Cloudflare account owner's informed, explicit consent obtained (§2.1) — this is a hard gate, not a courtesy
- [ ] Scope agreed: which venues, which characters (Happy Hogs dancers are anthropomorphic hogs — see §5), whether the state is opt-in per launch, encore-gated, or default
- [ ] Re-review triggers acknowledged (§8)

## 1. Content definition — pin down exactly what ships

- [ ] Written content spec: which meshes/layers are affected, per venue, per character. No "shader that permits it" hand-waving — enumerate the states a player can actually see
- [ ] Default state decided: clothed until a per-launch opt-in? Default-visible? Persistent? (This changes every §2–§4 answer downstream)
- [ ] Inventory every exposure surface: stage routines, encore, private-dance activity, minimap/headless screenshots, `cover.png`, README images, any future trailer
- [ ] Multiplayer surface verified: are club interiors ever replicated or visible to other sessions? (Club interiors are locally rooted today — verify in `server/index.js` + `main.js` that nothing about the venues streams)
- [ ] Savegame surface: `src/savegame.js` currently stores position/hp/cash/guns — confirm no venue/outfit state would leak across modes or into a fresh adult-gate answer (the gate is answered *every* launch by design)
- [ ] Fictional-only check reaffirmed: no real names, likenesses, or venues (the Billy Jeans parody character rule from the design note)

## 2. Host: Cloudflare Pages (the live site)

The site (`grand-theft-bayou-c2l.pages.dev`) runs on Cloudflare Pages under the
Self-Serve Subscription Agreement — indexed at
https://www.cloudflare.com/legal/terms/ — which carries the acceptable-use
restrictions. Cloudflare also handles abuse reports via its Trust & Safety
process (https://www.cloudflare.com/trust-hub/abuse-approach/).

- [ ] **2.1 Account ownership (the sharpest risk in this project):** the account is the *friend's*, not the human's. A policy complaint, abuse report, or account suspension lands on *their* Cloudflare login, their other projects, their name. Get written ("a Slack message is fine") consent from the account owner *after* showing them what the content will look like. Without that, the answer is no.
- [ ] **2.2 Read the current SSSA + AUP text from the legal-terms index above.** Verify the live AUP link from there — the standalone `/aup/` path was dead when this checklist was written (2026-09-27), so the canonical text must be found from the index each time. Confirm the AUP's handling of adult content in the *current* revision, not cached copies
- [ ] **2.3 Community answers are not policy.** Forum replies of the form "lawful adult content is allowed, you're responsible for legality" are customer-support folklore. If the AUP text does not address adult content explicitly, the correct posture is "unaddressed = at the account owner's risk," not "permitted"
- [ ] **2.4 Pages-specific terms:** check the Service-Specific Terms (also linked from the legal-terms index) for anything on static-site content — historically Cloudflare's content rules were written for its proxy/CDN products, and Pages inherits the umbrella agreement
- [ ] **2.5 Deploy path frozen until §0 is complete:** remind all agents (per `AGENT_PROTOCOL.md`) that pushing the feature branch to `main` publishes the content to the friend's account. Suggested guardrail: keep the work on a branch and let the human run the merge
- [ ] **2.6 Distribution precedent (from Appendix A.3):** every mainstream/explicit-game precedent (Cyberpunk, eroge, Newgrounds adult titles) ships through ratings boards, platform certification, or age-gated storefronts. If this direction is ever approved, the matching path is adult-capable distribution (itch.io age gates, Steam adult-flagged builds, DLsite-type storefronts), with the free Pages site either staying below the threshold or pointing to the gated storefront — not hosting the explicit content itself

## 3. Code host: GitHub (this repository)

GitHub's Acceptable Use Policies prohibit content that is "sexually obscene or
relates to sexual exploitation or abuse," and the dedicated
[Sexually Obscene Content policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-sexually-obscene-content)
adds: *"We do not allow sexually themed or suggestive content that serves little
or no purpose other than to solicit an erotic or shocking response, particularly
where that content is amplified by its placement in profiles or other social
contexts"* — including *"Graphic depictions of sexual acts … animation,
drawings, computer-generated images."* The same policy recognizes that not all
nudity is obscene and may allow it in artistic/educational contexts, sometimes
behind an opt-in.

- [ ] **3.1 The repo is currently private, but visibility is not a policy exemption** — policies apply to private repos too, and the repo can be made public later (forks, collaborators, a future open-sourcing push)
- [ ] **3.2 Assess the game against the "little or no purpose" clause:** a nightclub inside an open-world crime game has a narrative/artistic context (this is the argument that keeps GTA-style games on platforms at all); a venue that exists to show topless characters does not. Where the line falls is GitHub's call — rate the proposed spec honestly against both readings
- [ ] **3.3 The social-context surface is the most exposed one:** README, repo description, and `cover.png` are exactly the "placement in profiles or other social contexts" the policy singles out. If the game changes, the cover art and README must change with it or not show it
- [ ] **3.4 AI-generated content flag:** assets generated with AI tools carry their own GitHub disclosure expectations and, in some jurisdictions, labeling duties — record which, if any, assets are generated

### 3.5 Host alternatives — GitLab (raised 2026-09-27)

The human proposed migrating the repo to GitLab in response to §3. Findings from
GitLab's full AUP text (handbook.gitlab.com/handbook/legal/acceptable-use-policy/,
read 2026-09-27):

- [ ] **3.5.1 GitLab is stricter than GitHub for this content, not looser.** GitLab's AUP §1 prohibits hosting anything that is *"vulgar, obscene, or pornographic"* — with **no artistic/educational/journalistic carve-out**. GitHub's policy, by contrast, explicitly recognizes that *"not all nudity or content related to sexuality is obscene"* and allows artistic/educational contexts behind opt-ins. For a strip-club venue, GitHub is the *more permissive* of the two.
- [ ] **3.5.2 The spirit clause.** GitLab: *"We may take action to prevent use of our services which goes against the spirit of this policy, even if that use is not expressly forbidden."* Undefined terms ("vulgar," "obscene") + spirit-based enforcement = maximal discretion. Do not build content plans on GitLab's silence.
- [ ] **3.5.3 Do not conflate the AI clause.** The AUP's *"Adult industries or sexually explicit content and services"* line sits in the **AI-powered-services** section (what you may build using GitLab Duo), not the hosting rules. It is not a hosting permission; it is not the relevant clause either.
- [ ] **3.5.4 The migration also touches the game's existing content.** The same §1 clause prohibits *"gratuitously depicts or glorifies violence"* — and the current game already ships gore and graphic violence per its own launch gate. A GitLab migration re-exposes the *existing* build to a vaguer policy, before any new content is added. Rate the current game against that clause before moving anything.
- [ ] **3.5.5 GitLab Pages inherits the same AUP** ("all services (including related websites)"). Moving the *site* to GitLab Pages changes nothing material.
- [ ] **3.5.6 The genuinely different path is self-hosting the site**, not repo-host shopping: a static build (this game is one) can be served from any box the human controls, which removes the §2 host-policy layer entirely — while §4 (law) follows the publisher and stays exactly where it is.

**Conclusion recorded:** host-shopping between GitHub and GitLab does not solve the §2/§3 problem; GitLab's policy is tighter. The options that actually change the analysis are (a) keep content below the harmful-to-minors threshold (§4.2), (b) self-host the site (§3.5.6), or (c) get the account owner's informed consent and accept the residual risk (§2.1).

## 4. Law — pointers for counsel (not legal advice)

The game is set in Louisiana, publishes on a US host, and is reachable
worldwide. The most on-point statute found so far:

- [ ] **4.1 Louisiana Act 440 (2022), codified at La. R.S. §14:91.14** — verify the citation and current text (https://legis.la.gov/legis/ViewDocument.aspx?d=1289498). It targets *commercial entities* that knowingly publish "material harmful to minors" **"from a website that contains a substantial portion"** of such material — commonly read as roughly one-third of a site's content (secondary sources; confirm)
- [ ] **4.2 The substantial-portion question applied to this game:** a strip-club venue is a small fraction of the game's assets and playtime, which argues the site stays below the threshold — but a court weighs *content, prominence, and appeal to minors*, not file counts. Frame this for counsel as a question with the numbers (asset counts, screen time, venue count vs. total), not as a conclusion
- [ ] **4.3 The current 18+ gate does NOT become "age verification" by existing.** `adultContent.js` implements per-launch *self-attestation* (two buttons, nothing stored). Act 440-style laws generally require credential- or ID-based verification before *material harmful to minors* is served. So the compliance options are: (a) keep content below the legal threshold (recommended), or (b) integrate a real age-assurance vendor — a much heavier change. Self-attestation is fine *for* (a), useless for (b)
- [ ] **4.4 Enforcement mechanism:** the Louisiana AG maintains/publishes a list of sites alleged to violate the law; check what landing on it means in practice (payment-processor and host notification cascades tend to be the real damage, before any court)
- [ ] **4.5 Penalties:** confirm current amounts with counsel (civil action with penalties and fees — do not quote numbers from blog posts)
- [ ] **4.6 Wider jurisdictions, light pass:** Miller-style local-community obscenity standards (US states), UK Online Safety Act Part 5 duties (likely inapplicable for a game, but confirm), EU DSA notice mechanisms. One paragraph each, from counsel, or explicitly marked "not reviewed"
- [ ] **4.7 "Commercial entity" status:** the game is free with no ads today. Confirm what it takes to stay non-commercial (no donations, no ads, no store) — because §4.1 only reaches commercial publishers, and the day the game monetizes, this section re-opens
- [ ] **4.8 The legal layer is host-independent.** Act 440 (and every obscenity/harmful-to-minors regime in §4.6) attaches to the *publisher of the website*, not to the code host. Migrating the repo to GitLab, Codeberg, or a private server changes §2/§3 exposure only; §4 follows the human wherever the site is served from. There is no repo host that relocates legal liability.

## 5. Minors' appeal factors — the project-specific wrinkle

- [ ] **5.1 The Happy Hogs cast is anthropomorphic cartoon hogs.** Cartoon animal characters are precisely the aesthetic that gets cited as "appealing to children" in complaints about adult content. A topless cartoon hog is simultaneously a parody and a complainant's exhibit A. Decide with open eyes: does the R18+ presentation apply to the Billy Jeans venues only, and do the hog dancers stay clothed?
- [ ] **5.2 Style history:** the game's screenshots/records include blocky procedural characters and pixel-art history — the "looks like it's for kids" argument is already available to any complainant. Weigh §5.1 + §5.2 together when rating the content spec
- [ ] **5.3 COPPA:** likely irrelevant while the site is adult-gated and non-commercial, but confirm the gate's per-launch design doesn't itself create a "directed to children" argument (it doesn't today; re-check if §5.1 changes)

## 6. Technical gates (what engineering would have to change)

- [ ] **6.1 The gate stays per-launch** (no "remember me"), per the design note — any implementation must not weaken `adultContent.js`
- [ ] **6.2 Region-gating option (if §4 says it's needed):** Cloudflare Pages Functions can read the visitor's country header and serve clothed variants to stricter regions — or keep everything below the threshold and skip the complexity entirely. Record which was chosen and why
- [ ] **6.3 QA surface:** any implementation adds deterministic tests alongside `tools/qa/adult_content_test.mjs` / `franchise_clubs_test.mjs` (the "allFullyClothed" debug assertion is currently a *guardrail*, not an inconvenience — whatever changes it needs a replacement assertion)
- [ ] **6.4 Multi-agent review surface:** `AGENT_LOG.md` reviewer heuristics already flag untagged `ShaderMaterial`s and content-boundary drift — an implementation must be announced in `TODO.md` and reviewed against this checklist, not slipped in via a perf PR

## 7. Recording the outcome

- [ ] Update the TASK-088 design note in `TODO.md`: decision, date, and a pointer to the filled-in copy of this checklist
- [ ] If **denied**: the design note's "not implemented yet" line stays, and this file records why (useful against future re-requests)
- [ ] If **approved**: a new task brief with the content spec from §1, the technical gates from §6, and the branch/merge guardrail from §2.5

## 8. Re-review triggers

- [ ] Cloudflare or GitHub policy text changes (re-verify links in §2/§3 quarterly — they rot)
- [ ] Any monetization appears (§4.7)
- [ ] The repo goes public or gains new collaborators
- [ ] Louisiana (or another jurisdiction of the players' concentration) updates its age-verification law
- [ ] Any abuse report, complaint, or host contact of any kind → pause the feature, review, tell the account owner

---

## Appendix A — Objections & responses (review history)

Recorded so future reviewers (Claude, Antigravity) don't relitigate the same
arguments. Each entry: the objection as raised, and the response that stands in
this review.

**A.1 "The game is R18+, so no minors will be playing it." (2026-09-27)**
- The rating is a claim about the intended audience, not a mechanism. The launch gate in `adultContent.js` is per-launch self-attestation; it has never been age *verification*, and Louisiana passed Act 440 precisely because self-attestation fails its statutory bar. The label buys good faith, not compliance.
- Host policies attach to *content*, not to self-description — neither GitHub's nor GitLab's policy has an "unless the site is rated R18+" clause.
- Where the rating *does* carry weight: §4.2 (keeping adult content a small *portion* of a large work keeps the site below the substantial-portion threshold) and §3.2 (narrative/artistic context for GitHub's obscenity analysis). Both depend on context and proportion, not on the label.
- §2.1 is unaffected by any rating: deploys land on the friend's Cloudflare account, and "it's rated R18+" is not a defense they can offer trust & safety on the human's behalf.

**A.4 "The gate already appears before the menu; the game already has gore, violence and crime — why are topless dancers the line?" (2026-09-27)**
- Conceded: the asymmetry is real. Anglo-American ratings regimes (ESRB, PEGI, and the underlying law) treat violence far more leniently than sexual content. That is a documented inconsistency of those regimes, not a project invention, and this review does not defend it
- Why it exists: violence has no obscenity doctrine — there is no US legal category of "violent obscenity." Sexual expression carries an entire extra body of law (Miller obscenity, harmful-to-minors statutes like Act 440, record-keeping and minor-protection regimes with strict liability). Hosts and payment processors mirror that asymmetry in their AUPs. The two content classes are graded on different rubrics, so "the gore already ships" is not precedent for the nudity — they never shared a rubric
- The launch gate: genuinely good design (honest per-launch disclosure is exactly what §6.1 requires), and "this isn't a sex game" is itself the strongest argument *inside* this review — a club venue inside a large crime/horror game is precisely the small-portion + artistic-context combination §4.2 and §3.2 reward. The review's path and the human's argument converge; they do not conflict
- Standing caveat: if presentation ever changes, the gate copy (which already discloses "sex and sexual themes") must be re-checked against actual content per the TASK-088 alignment note

**A.3 "Flash games on Newgrounds are just as explicit without warnings; Cyberpunk 2077 and Japanese visual novels ship the same or worse." (2026-09-27)**
- Conceded: explicit content in games is normal, legal, and common. Nothing in this review claims otherwise, and no objection here is moral
- But every example cited shipped *inside an apparatus built for it*: Cyberpunk 2077 went through formal ratings (ESRB M / PEGI 18, with nudity/sexual-content descriptors) plus platform-holder certification on Sony/MS/Valve storefronts; Japanese 18+ VNs (eroge) are not on general-purpose hosts at all — they sell through dedicated adult storefronts (DLsite, Fanza, JAST) with real age gates, and mosaic-censored builds for Steam; and Newgrounds, despite its anything-goes reputation, runs its own maturity-rating system and gates "A"-rated content behind logged-in 18+ accounts. The user's premise ("no warnings") is factually wrong for all three
- The pattern across the entire precedent set is the opposite of the proposal: content of this class ships *through ratings and age-assurance systems*, and never by being dropped on a free, ungated webpage on a general-purpose static host
- Practical consequence, recorded in §2.6: if the direction were ever approved, the industry-shaped path is adult-capable distribution (itch.io age gates, Steam adult-flagged builds, DLsite-type storefronts) — not Cloudflare Pages

**A.2 "Then we'll host it on GitLab." (2026-09-27)**
- Answered by §3.5: GitLab's hosting policy is *stricter* than GitHub's for this content (flat "vulgar, obscene, or pornographic" prohibition, no artistic carve-out, spirit-clause enforcement), and §4.8: no code host relocates the publisher's legal exposure.
- The implementation refusal recorded in the first review pass was never GitHub-dependent and is unchanged by a migration.

---

*Drafted 2026-09-27 by Buffy (Freebuff) at the human's request. Sources read when drafted: GitHub AUP + Sexually Obscene Content policy (verbatim quotes above), Cloudflare legal-terms index + Self-Serve Subscription Agreement description, Cloudflare Website Terms of Use, GitLab Acceptable Use Policy (full text), Louisiana Act 440 primary text + CRS overview. Every external policy link must be re-verified at review time.*
