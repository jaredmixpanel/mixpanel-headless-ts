# My AI agents ported our Python library to TypeScript. Then I read the logs to find out how.

*August 2026*

Over three days in August, our analytics library (roughly 71,000 lines of Python, carrying a test suite twice that size) acquired a TypeScript twin. I was present for this the way you're present for a dishwasher cycle. I kicked it off with one prompt, answered roughly ten questions over three days, and got back a working library.

Here's what came back: 3,262 recorded behavioral scenarios passing identically in both languages. 9,988 new TypeScript tests. Four real bugs discovered in the *original* Python library, one of them a security leak that had been shipping for months; all four are now fixed upstream. Total cost, estimated from token counts: somewhere between $2,400 and $3,200, spent across 180 AI agents running in 19 background workflows. For calibration, Anthropic's [Bun migration](https://claude.com/blog/ai-code-migration) (a million lines of Zig to Rust) ran about $165,000 against a manual estimate of $3–4 million; ours was a much smaller job, and it priced like one.

The honest part, and the reason I'm writing this: I don't entirely know how it was done. Nearly all of it happened in autonomous workflows while I was doing other things. People have started asking me how it worked, and "I answered ten questions and it happened" is true but useless. So I did the only reasonable thing. I went back and read the logs my agents left behind (design packets, review arbitrations, gate reports, a few thousand lines of them) and reconstructed what my own project did while I wasn't looking.

The interesting parts turned out to be about verification, almost never about translation.

## Standing on other people's lessons

We didn't invent this approach. Before writing a line of anything, the planning phase digested the handful of serious write-ups that existed, and the plan is honest about what it took from each.

From [Anthropic's migration playbook](https://claude.com/blog/ai-code-migration): write the rulebook before fanning out, make review adversarial, and (the line that shaped this project more than any other) *validate the judge*. "Run it against the original code to confirm it passes. Then run it against deliberately broken code to confirm it fails. A judge that doesn't catch breakage isn't a judge." From [Google Research](https://research.google/blog/accelerating-code-migrations-with-ai/): when something fails, fix the pipeline that produced it, not the individual output. From [Daniel Janus](https://blog.danieljanus.pl/2026/03/26/claude-nlp/), who ported two Polish NLP libraries for about $50 and validated by diffing 321,331 outputs across an entire novel: the instinct that the original implementation is the best test oracle you will ever have.

And from the [ScanCode case study](https://aboutcode.org/blog/agentic-scancode-port-case-study/), the ghost story. An AI agent ported a beloved open-source scanner (90,000+ tests, 700+ contributors, a decade of work) to Rust. It passed some tests. It claimed 10–100x speedups. And when the maintainers checked, it was skipping files and missing detections. Their conclusion: passing a *subset* of tests tells you nothing about the whole. Our plan literally names one of its defense layers "the anti-ScanCode layer."

One more thing tilted the design toward paranoia. A benchmark study covering [110,000+ translations across 14 languages](https://arxiv.org/abs/2410.09812) found that language models are measurably weaker translating *out of* Python than into it. We were going in the hard direction. So the plan's core bet was: don't trust translation skill at all. Make verification carry everything.

## Don't translate the test suite. Compile it.

That sentence is the first big idea in the plan, and it's the one I'd keep if I could only keep one.

The obvious way to port a test suite is to have agents translate the tests along with the code. The problem is that a translated test is just more translated code — it can be subtly wrong in exactly the ways the code is subtly wrong, and now your check and your work share a failure mode. The ScanCode trap, again.

Our Python tests had a useful property, though. Nearly half the library's job is wire plumbing (build an HTTP request, parse a response), and the tests assert on it through a single fake-network seam. Every mocked test injects the same `MockTransport` object. Which means that seam is a one-way mirror: patch it once, and you can watch every byte the library would have sent to Mixpanel, in every test, without changing anything about how the tests run.

So instead of translating tests, a recorder was bolted onto the suite. Run the whole thing once in "record mode," and every test emits a **vector**: a small, language-neutral JSON record of what the library was asked to do and exactly what it did. Here's a real one, extracted from a cohort-deletion test:

```json
{
  "call": {
    "api": "api_client.delete_cohort",
    "input": { "cohort_id": 1 },
    "session": { "type": "oauth_token", "project_id": "12345", "region": "us", "token": "test-oauth-token" }
  },
  "expect": {
    "interactions": [{
      "request": {
        "method": "DELETE",
        "path": "/api/app/projects/12345/cohorts/1",
        "headers_contain": { "authorization": { "pattern": "^Bearer test-oauth-token$" } }
      },
      "response": { "status": 204 }
    }],
    "result": null
  }
}
```

That's a complete cross-language behavioral contract in about 700 bytes. It says: log in as this fake account, call `delete_cohort(1)`, and I expect exactly one DELETE to exactly this path with exactly this auth header, and a null return. Any language that can make that call and produce that wire traffic passes. The Python suite compiled down to 3,042 of these, plus 220 hand-authored ones for edge cases the suite never covered: 1,208 recorded from wire tests, 1,769 from pure builder tests, 65 from validation-error tests.

This is not a new pattern, which is part of why I trust it. It's how [Wycheproof](https://github.com/C2SP/wycheproof) tests cryptography libraries across languages, and how the [JSON Schema test suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) keeps dozens of validators in twenty-odd languages agreeing with each other: the tests are plain data files, and each language brings a thin harness. What's slightly novel here is that nobody wrote our vectors. They were *extracted* — mechanically, from six years of accumulated test-writing judgment, with the transcription step (the part where humans or agents introduce errors) deleted from the process.

Two details from the extraction machinery stuck with me. First, the recorder keeps an honesty ledger: every test that *didn't* produce a vector is accounted for by category, with the exact test IDs (2,125 never touched a recordable seam, 537 were property-based tests with random inputs, 506 were CLI tests, and so on). The denominator is auditable; nothing was dropped without a paper trail. Second, the Python repo's CI now re-runs the recorder on every PR and byte-compares the output against the committed corpus, in both directions. If anyone changes Python behavior without regenerating the vectors, the build fails. The original is permanently held to its own recorded word.

## Test the smoke detector by lighting real fires

A corpus that passes on the original proves the corpus *runs*. It doesn't prove the corpus can catch anything. This is the "validate the judge" lesson, and the project's version of it is my favorite artifact in either repo.

Fourteen sabotage patches, each a realistic one-line bug, were written against the Python source. Flip a `<=` to `<` so zero IDs become legal. Replace date validation with `pass`. Change the US query endpoint to the EU one. Invert a pagination loop condition. Swap `"equals"` for `"!="` in the filter operator map. Delete the rate-limit retry loop. Each patch gets applied to a throwaway copy of the codebase, and the corpus must catch every single one: at least one failing vector, and a runner *crash* explicitly doesn't count as a catch.

All fourteen fires set off alarms. The burn log is committed to the repo, and it reads like a physics experiment: the endpoint-region swap tripped 236 vectors at once, the flipped filter operator tripped 7, and the two subtlest sabotages (a funnel conversion-rate denominator bug and an empty-cohort retention flip) tripped exactly 2 each. Two is a lot smaller than 236, and I'd rather know that than not. The log records which alarm rang first for every fire, and it refuses to write itself unless the full protocol ran, so a partial re-run can never masquerade as a complete one.

If you're wondering why not mutation testing (the automated version of this idea), we descoped it deliberately. Fourteen hand-chosen, realistic bugs with a committed burn log turned out to be a better fit for this pipeline than thousands of random mutants, and vastly cheaper. That was one of my ten decisions, for what it's worth.

## Two languages that disagree about reality itself

Vectors are the floor. The ceiling, the thing that catches what no recorded scenario covers, is a differential oracle: two small bridge processes, one wrapping the Python library and one wrapping the TypeScript port, receiving identical randomly-generated inputs and required to produce byte-identical canonical answers. Any disagreement blocks the gate it happened at until it's explained and fixed. By the end, the fuzzer covered 55 families of entry points at 28,091 examples per seed, and every quality gate replayed *every prior gate's seeds* plus a fresh one (eleven seeds by the final gate, all clean).

The fuzzer's trophy wall is where this project stopped feeling like a translation exercise to me and started feeling like an expedition into how deeply two languages can disagree while both being "correct":

**They disagree about invisible characters.** On the very first fresh-seed run at the first quality gate, the fuzzer generated an event name consisting of a single U+0085, the NEL character, a leftover from 1980s mainframe encodings. Python's `str.strip()` considers it whitespace and rejected the name as empty; JavaScript's `trim()` does not, and accepted it. The divergence runs in both directions: JS trims U+FEFF, which Python keeps. Thirteen validation guards across the port had this bug. All thirteen were fixed with a `pythonStrip` function pinned to CPython's actual 29-codepoint whitespace table, and the rulebook gained a standing ban: bare `trim()` and `parseInt` are now forbidden in ported code. No human would ever have written that test.

**They disagree about what Unicode *is*.** Node's V8 engine ships Unicode 17; CPython 3.14 ships Unicode 16. A character assigned in the newer edition is "printable" to JavaScript and "unknown, escape it" to Python, and the fuzzer found the divergence in `repr()` output. The fix amounted to a small act of secession: the port generates its printability tables *from CPython itself* (737 ranges, provenance-stamped "CPython 3.14.6, Unicode database 16.0.0") and ships them, so the TypeScript library behaves identically regardless of which JS engine or Unicode edition it runs on.

**They disagree about numbers.** Python distinguishes `18` from `18.0`; JavaScript has one number type, and `JSON.parse` collapses the two and rounds any integer above 2^53 without a word of complaint. Either mangling would have corrupted thousands of comparisons, or worse, made a wrong port look right. So the TypeScript side has its own lossless JSON parser that keeps every number's original spelling as text until the last possible moment, and both languages must pass one shared canonicalization self-test whose test cases are stored as raw strings precisely so the container file's own parsing can't destroy them.

**And once, the rig caught itself.** At the sixth gate, a replayed seed reported that Python raised `KeyError` where TypeScript raised `KeyError2`. There is no `KeyError2`. Two same-named classes existed in the codebase, and the JavaScript bundler renames one when they collide; *which one* depended on import order, which an unrelated change had just flipped. The comparison machinery itself had a landmine, and the machinery's own seed-replay policy found it. Who watches the watchmen? Replaying old seeds after every change, apparently.

## Asking the house for its answer key

Everything so far proves TypeScript matches Python. None of it answers a scarier question: what if they're *both* wrong about what the server accepts?

This project had an unfair advantage its predecessors didn't: we're Mixpanel, and the server's own source of truth was sitting in a sibling checkout. So the verification stack got three "referees" that judge payloads against the house's actual rules: the server's bookmark JSON Schema, vendored with sha256 fingerprints; the *actual server-side parser* for saved reports, run offline against every recorded payload; and Mixpanel's generated API types, byte-diffed against their source on every run.

The referees are how the port ended up filing bugs against the original. Both implementations were emitting a `dataGroupId` as a number where the server contract demands a string. Faithfully identical, identically wrong, and invisible to every layer that only compared the twins to each other; the referee holding the server's schema caught it at a batch gate. Another referee, the server-side parser, had rejected the library's frequency-filter clause shape since the first week, and an agent was dispatched to settle whether that rejection was real or just a stale validator. It ran a live probe on a hard budget of three API calls. Pick a high-volume event. Run a baseline query: 77,705,787 events, success. Run the identical query plus a frequency filter: server error 500. The library had been generating a query shape Mixpanel's own servers can't execute, and nobody had noticed because the server's validation for that clause runs in log-only mode. The probe record notes, with a candor I've come to appreciate in these logs, that this was n=1 and the budget was exhausted before a confirmation retry.

Four genuine Python bugs came out of this: the frequency-filter shape, the `dataGroupId` typing, a 403 handler that crashed with a raw `TypeError` on legal-but-weird response bodies, and (found by a security-focused review agent working blind) an OAuth failure path that embedded the user's *actual login tokens* in the error details, which is precisely the thing applications ship off to logging services.

What happened next is the discipline I'd least expect from an AI system left unsupervised: nothing. The rules said latent Python bugs are *reproduced verbatim* in the port, bug-for-bug, with tests asserting the crash, because fixing TypeScript alone would desynchronize the twins and blind the oracle. The TypeScript port carried a faithful reproduction of a `TypeError` crash, with regression tests ensuring it kept crashing exactly like Python, until the Python fixes landed through their own reviewed pipeline at the end. Then both sides flipped together, the corpus was re-recorded, and the referees ran fully clean for the first time in the project's history (the standing rejections had been disclosed on every prior gate report, never hidden).

## The org chart

The part people actually ask about: what were the 180 agents *doing*?

Roughly: behaving like a slightly paranoid engineering org. The pipeline ran as one background workflow per phase or batch (ten batches for the port proper, in dependency order), each one a little assembly line. A designer agent writes the batch's work packets. Implementation shards execute them under strict test-first rules. Every module then runs a throwaway differential harness with a mandatory edge-case set: integral float, `True`, `None`, empty string, a non-BMP character, every error branch. The rulebook is that specific because an early harness whose only float was `1.5` reported false parity. Then two adversarial reviewers with different assigned lenses go over everything, an arbiter re-verifies each of their findings against source and applies fixes red-first (failing test before fix, always), and a gate agent replays the entire corpus, all the fuzz seeds, and the referees before the batch can close. Nothing merged red in three days. The pass count marched 539 → 1,229 → 1,528 → 2,370 → 2,876 → 3,230 → 3,244 → 3,251 with zero failures at every gate, six of those gates closing in a single day.

Before any of that started, there was a dress rehearsal I still think about. Three modules were ported *twice*, by two independent agents with different instructions, and an arbiter diffed the results. Every line of code from that exercise was thrown away. What survived was 32 amendments to the rulebook, the document that governed every later decision. The rehearsal existed to find out where two reasonable porters would disagree, and to legislate the answers before 180 agents could disagree at scale.

For the security-sensitive batches, review was doubled and *blinded*: a second reviewer pair worked with no access to the first pair's findings. This sounded like expensive paranoia until I read the convergence stats. On the node-auth batch, the two pairs found *disjoint* major bugs (a wiring defect and a value-domain defect), and the gate record notes drily that a single-pair review would have shipped one of the two. On the browser batch, the sighted pair, anchored to the design packet's enumeration of credential paths, passed the code. The blind pair, forced to re-derive the attack surface from the requirements alone, found two exploitable holes in it: a documented helper method that handed out clients bypassing the service-account guard, and a raw class re-export that skipped both browser gates entirely. Guards on the front door; side doors wide open. The checklist itself was the blind spot.

My favorite of these: when the OAuth token-leak bug was finally fixed, the *fix* went through the same blind review. One pair found the new redaction code crashed on list-shaped responses. The other pair attacked the redaction itself and found three more ways tokens still leaked — nested one level deep, inside truncated non-JSON bodies, as a bare string. The final fix inverted the whole approach from a deny-list to an allowlist: instead of enumerating what to hide, enumerate what's provably safe to show and redact everything else. That's a textbook security lesson, and it was taught here by one team of AI reviewers to another.

The economics had a rule I keep quoting: *the judge must be stronger than the judged.* Volume translation ran on a cheaper model tier; design, review, arbitration, and anything touching the verification rig itself never left the strongest tier. The stats bore it out. Review findings concentrated exactly where the cheaper model had written the code, and the strong-tier reviewers caught what it dropped, including a `bool`-is-an-`int` Python subtlety that the work packet had explicitly warned about in writing.

And the failures were process failures, with process fixes. Early agents at maximum reasoning effort kept getting killed by the platform's three-minute silence detector; one designer died six times in a row, vanishing into its own head at whole-document-planning moments. The fix became a binding rule: less headroom for silent thinking, write a skeleton to disk immediately, fill it in section by section, leave a visible heartbeat. When the orchestrator once dispatched two work shards in the wrong order, the implementing agent *refused to absorb the unreviewed scope* and blocked instead. That was the right call, and it's now enshrined as a packet-authoring rule. Bureaucracy, but the kind that updates its forms.

## What the human actually did

I count nine or ten decisions across three days. Scope calls (mutation testing out; a Python-side cleanup pass approved before Phase 2). Four escalation questions the agents couldn't answer on their own, mostly about which source of truth wins when internal docs disagree. Approving the model-tiering plan. One live catch: I noticed a task was running on the wrong model (the harness had resolved "sonnet" to the previous year's model) and pulled that tier from the program the same day; the wrong-model output was re-audited line by line, and its hand-waved tests thrown out. One technical override: the agents proposed excluding a JavaScript key-ordering divergence from the contract, and I overruled them and made them fix it properly, because it changed a user-visible output. That fix ended up proven with a 1,000-case differential against live CPython. And the merge/publish gates stayed human, which is why the PRs sat open for my review at the end instead of merging themselves.

Everything else, I reviewed the way the Anthropic post recommends: loop results, not code. I can tell you honestly what that feels like — a low hum of unease that never quite goes away, resolved not by reading diffs (I mostly didn't) but by the quality of the paper trail. When I asked "why did that gate close and then retry?", the logs had an answer: the gate's fresh fuzz seed had found the whitespace bug, blocked itself, dispatched the fix, and re-verified. When I asked what a puzzling agent was doing, its notes file explained. The system was legible *after the fact* in a way I've never experienced with a human team moving this fast, because writing everything down was a load-bearing rule, not a courtesy.

## What I'd tell you to be skeptical about

The live-parity layer (running both implementations against Mixpanel's real production API nightly and diffing results) has not run yet. It's specified, scheduled as a multi-night burn-in, and required before this port is called *done* done; everything above compares the twins to each other, to recorded traffic, and to the server's offline validators. The browser login flow was verified to the point of a real registration succeeding against production, and the docs are required to say "end-to-end consent flow to be verified in burn-in" rather than claim more. There's a known, documented gap around integers above 2^53 in one result path. The cost figure is an estimate from token counts, not an invoice. And the corpus, for all its 3,262 vectors, is still a floor: it covers what six years of tests thought to check, plus what the fuzzer's random walks and the referees' schemas have caught since. ScanCode taught everyone what "some tests pass" is worth; I'd hold this project to the same skepticism until the burn-in nights are green.

One more thing, because the ScanCode maintainers deserve the acknowledgment: their post is about an outsider strip-mining a community's decade of work, and their sharpest technical point, that the test suite *is* the specification, is exactly right. It's the point this entire project is built on. The difference is that we compiled our own specification out of our own tests, on our own code, with the license and the history intact and the original library continuing as the reference implementation, permanently. That's the legitimacy line, and it's brighter than the tooling debate.

## The scoreboard

| | |
|---|---|
| Source | ~71K LOC Python, ~7,000 tests |
| Output | TypeScript monorepo: core + node + browser packages, 9,988 tests |
| Shared contract | 3,262 conformance vectors, green in both languages |
| Differential fuzzing | 55 entry-point families × 28,091 examples × 11 seeds, zero divergences |
| Judge validation | 14 sabotage patches, 14 caught |
| Bugs found in the original | 4 (all fixed upstream, Python-first) |
| Wall clock | ~3 days |
| Agents / workflows | ~180 / 19 |
| Estimated cost | $2,400–3,200 |
| Human decisions | ~10 |

The code, I'll admit plainly, I cannot vouch for line by line — I didn't read most of it, and pretending otherwise would be the least trustworthy sentence in this post. What I can vouch for is the evidence: a corpus extracted rather than written, a judge that was tested with real fires before being trusted, two implementations that agree with each other and with the server's own answer key on everything anyone has thrown at them, and a paper trail that answered every question I brought to it, including the ones for this post.

I used to think the artifact of a software project was the code. Three days of reading these logs have me half-convinced the artifact is the verification, and the code is just whatever it happens to be checking today.
