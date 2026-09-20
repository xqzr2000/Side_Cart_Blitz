# FAQ

## What's WiseShelf?

A Unified Shopping Cart Where AI Agents Help You Budget.

Hear our elevator pitch here:

https://github.com/user-attachments/assets/027a1568-23c4-4c7b-84ea-4b14025e307e

- Budget-first shopping
- One cart across multiple stores
- AI-powered price intelligence
- Smarter product alternatives
- Persistent shopping history
- Multi-retailer support
- Real-time budget guidance

WiseShelf helps you shop smarter, stay on budget, and build better financial habits with every purchase.

WiseShelf: Turning Every Shopping Experience Into a Budgeting Lesson.

WiseShelf: Everyone's Budgeting Bestie.

<img width="2172" height="724" alt="Coachella" src="https://github.com/user-attachments/assets/fd7a0f04-cc84-4f8d-b797-2290519358ca" />

---

## Are there any competitors?

Yes.

While WiseShelf combines a unified shopping cart with AI-powered budgeting, several products offer overlapping features:

- **[Google Universal Cart](https://blog.google/products-and-platforms/products/shopping/google-shopping-cart/)**: Lets users save items across retailers, track prices, and receive shopping recommendations.
- **[Honey (PayPal Honey)](https://www.joinhoney.com/?utm_source=chatgpt.com)**: Offers coupon discovery, price tracking, and deal alerts.
- **[Shop App by Shopify](https://shop.app/?utm_source=chatgpt.com)**: Supports cross-store shopping, recommendations, and checkout management.

---

## What makes WiseShelf different?

Product Market Fit, we are focusing on a specific market:

> **Budgeting for College Freshman**.

- **Learning independence**: For many students, it's their first time managing money on their own. WiseShelf helps them build healthy spending habits from day one.
- **Budgeting on the go**: Every purchase becomes a learning opportunity, with AI agents providing real-time budgeting guidance.
- **A lifelong financial companion**: From college to careers, first cars, homes, and families, WiseShelf grows with our users through every life stage.
- **Budget, Yes; Influence, NO**: Unlike services designed to encourage spending, WiseShelf is built around your financial well-being.
- **Highly concentrated market**: Because freshmen are often required to live in campus housing, customer acquisition can be focused, scalable, and cost-effective.

> We're turning every shopping experience into a budgeting lesson, starting with college freshmen and growing into a lifelong financial companion.

- Starts with shopping, where users already are.
- Extends beyond college and beyond a single purchase.
- Supports your vision of being a lifelong financial companion.
- Connects naturally to learning independence and building habits.

---

## Who are Mom and Bestie?

Mom and Bestie are WiseShelf's AI agents, always ready to talk.

- Mom teaches budgeting basics and helps you build smart spending habits.
- Bestie looks out for your wallet by spotting upcoming expenses, finding better deals, and turning the things you want into savings plans she can actually set up for you.
- Together, they help you shop smarter, spend wisely, and stay on budget.

---

## Demo-1: Budget Rescue

- Add items to your cart from multiple online stores until the total exceeds your budget.
- Red light near budget.
- Ask Mom & Bestie: "Help! I'm over budget. What should I do?"
- Mom & Bestie analyze your cart and:
``` text
1, Identify what's pushing you over budget

2, Suggest lower-cost alternatives

3, Find better deals across retailers

4, Recommend what to keep, swap, or remove

```

Result: A smarter cart that fits your budget. 

---

## Demo-2: Save for a Goal

Open the chat and tell Bestie: **"I want to go to Coachella. Can you help me save for it?"**

This one is built, not mocked. Bestie has tools, and you watch her use them:

```text
1. Researching what this actually costs
   Bestie breaks the goal into line items — pass, flight, lodging, food,
   local transport, essentials — and the backend totals them.

2. Running the numbers against your budget
   Your budget, your entered bills, what you have already spent this month,
   and anything already reserved by other goals.

3. Creating your savings card
   A "Coachella Fund" card appears in the side panel while you are reading
   her message, and the monthly amount is reserved out of "Still free".

4. Finding ways to get there sooner
   Only from spending that is really in your cart or bills. Tap Apply and
   the item leaves the cart and the money lands in the fund.
```

**Bestie tells you the truth about the timeline.** With CA$900 a month, four bills
and a month that is already mostly spent, Coachella in April 2027 needs CA$355 a
month. You have about CA$150 that is genuinely free. So she reserves CA$150,
says out loud that this lands you in December 2027, and offers the trade: trim
these expenses, or aim at the next edition.

Result: Turn a wish into a plan, and a plan into reality — with a plan that admits
what it costs.

### Try it

1. `npm start` with an `OPENROUTER_API_KEY` in `.env`.
2. Extension **Options → Load demo data** seeds a first-year CAD budget.
3. Open the side panel, hit **Let's Talk**, and tap the Coachella quick-start chip.

### How it works

The interesting problem here is that language models are bad at arithmetic and
happy to invent prices. So they do not do either.

- **Every number is computed, not generated.** `backend/planner.js` owns the
  savings math — monthly capacity, contribution, timeline, feasibility. Bestie
  calls `draft_savings_plan` and quotes what comes back. The system prompt tells
  her that any amount she says out loud has to come from a tool.
- **Cost estimates are grounded.** `backend/cost-library.js` holds reference
  breakdowns and a static FX table, labelled as estimates rather than quotes.
  Set `OPENROUTER_WEB_SEARCH=true` to let her check live prices instead.
- **Suggestions are filtered against reality.** `suggest_savings_opportunities`
  drops anything that is not actually in your cart or bills, so Bestie cannot
  invent a latte habit for you to give up.
- **Capacity deliberately leaves slack.** A plan that claims every free dollar
  gets abandoned in week two, so only about half of what is free is offered.
- **The room is a conversation.** Bestie answers first because she is the one who
  can change the app; Mom then replies with Bestie's message and the real changes
  in front of her. Progress streams over SSE, so you see the tools running
  instead of a frozen spinner.

Tools live in `backend/tools.js`; `npm test` covers the math, the tool
guardrails, and the full room end to end against a stubbed model.

---

## Vision Demo-3: Mom-to-Mom Networking

The best budgeting advice I've ever heard was:

> "Don't buy if you can borrow."

The problem? Borrowing usually starts with asking someone, and for many of us, that's the hardest part.

With WiseShelf, you don't have to.

Your Mom agent does the networking for you.

**Disclaimer**: This is currently a vision concept. I don't yet have the infrastructure or code to support agent-to-agent social networking, but this is the direction I imagine WiseShelf evolving toward.

```text
1. In Talk, ask Mom

"I need a reference book for a side project. Is there any way I can borrow it instead of buying it?"

Mom gets to work

2. Find potential lenders

Mom searches the local WiseShelf community, starting with users on your campus, and discovers that another student already owns the book.

Mom-to-Mom networking

3. Reach out on your behalf

Instead of forcing you to message a stranger, your Mom agent contacts the owner's Mom agent:

"Hi! Tom is working on a side project and is looking for this book. Would your user be open to lending it for a couple of weeks?"

The two agents handle the introduction, availability check, and borrowing logistics.

```

Result: 

- A book gets shared instead of purchased.
- And even introverts get to benefit from a community network without the awkward first step.

WiseShelf turns borrowing into a socially effortless experience by letting trusted AI agents do the asking, coordinating, and matchmaking for you.

---


This demo shows the basic interaction, and the multi-agent chat room feature.


https://github.com/user-attachments/assets/d0b96be1-1f61-4ffd-98ce-f8f090df41ae

