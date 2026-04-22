# ═══════════════════════════════════════════════════════════════════════════════
# OPERATOR-OS — MASTER TECHNICAL SPECIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
#
# Version:           1.0 — Final Form
# Owner:             Akmal Khujdarov (BusyaPrime)
# Status:            Ready for parallel execution by multiple Claude Code agents
# Timeline:          6-week sprint to demo-ready killer product
# Target audience:   Claude Code agents implementing this system
# Parent project:    D:\Operator-OS-Dev
# Related:           D:\Operator-OS-Trend-Engine (dogfooding test)
#                    D:\Operator-HQ (personal knowledge workspace)
#
# This document is law. Deviations require explicit user approval.
# ═══════════════════════════════════════════════════════════════════════════════

# TABLE OF CONTENTS

## BOOK I — VISION & FOUNDATION
§ 1.  Executive Summary
§ 2.  The Problem We Solve
§ 3.  The Category We Create
§ 4.  The 5 Architectural Laws
§ 5.  Target Users & Personas
§ 6.  Competitive Landscape
§ 7.  Business Model & Pricing
§ 8.  Success Metrics

## BOOK II — SYSTEM ARCHITECTURE
§ 9.  High-Level Architecture Diagram
§ 10. Component Inventory (every service, every package)
§ 11. Data Flow: End-to-End Journey
§ 12. Communication Protocols (WebSocket, SSE, Polling)
§ 13. State Management Across Devices
§ 14. Event Bus Design (Pub/Sub topology)
§ 15. Offline-First Principles
§ 16. Scalability Strategy

## BOOK III — BACKEND (operator-os-api)
§ 17. Current State Audit
§ 18. Required New Endpoints (full catalog)
§ 19. Authentication & Authorization Model
§ 20. Multi-Device User Identity
§ 21. Command Dispatch System
§ 22. Streaming Infrastructure
§ 23. Agent Registry Service
§ 24. Cost & Token Tracking Service
§ 25. Notifications Service
§ 26. Audit Log System

## BOOK IV — DESKTOP AGENT
§ 27. Desktop Agent v1 Specification
§ 28. Platform Support Matrix (Windows first, Mac, Linux)
§ 29. Installation & Onboarding UX
§ 30. Command Execution Engine
§ 31. Subprocess Management (Claude Code, Codex, gh, git, npm)
§ 32. File System Operations Safety
§ 33. Screen & Window Awareness (later phase)
§ 34. System Tray Integration
§ 35. Auto-Update Mechanism
§ 36. Crash Recovery & Reconnect Logic
§ 37. Resource Monitoring (CPU, RAM, disk, network)

## BOOK V — MOBILE APPLICATION
§ 38. Mobile App Architecture (React Native + Expo)
§ 39. Complete Screen Inventory (every screen, every pixel)
§ 40. Design System (colors, typography, spacing, components)
§ 41. Navigation Flow
§ 42. Authentication Flow
§ 43. PC Pairing Flow (QR code + device code)
§ 44. Home Screen (everything a founder sees first)
§ 45. Agent Control Screen
§ 46. Live Terminal View (real-time subprocess output)
§ 47. Task Composer (voice + text + templates)
§ 48. Task History & Search
§ 49. Pull Request Review Screen (diff viewer on phone)
§ 50. Deployment Control Screen
§ 51. Cost Dashboard Screen
§ 52. Token Analytics Screen
§ 53. Agent Coordination Screen (multi-agent orchestration)
§ 54. Settings Screen
§ 55. Notifications Screen
§ 56. Push Notifications Strategy
§ 57. Voice Input Design
§ 58. Offline Mode
§ 59. Widget Support (iOS widget, Android widget)
§ 60. Apple Watch & Wear OS companion (future)

## BOOK VI — AI PROVIDER ABSTRACTION
§ 61. Multi-AI Router Architecture
§ 62. Provider Interface Specification
§ 63. Claude Integration (Anthropic API)
§ 64. OpenAI Integration (GPT-5, Codex)
§ 65. Gemini Integration (Google AI)
§ 66. Local Model Support (Ollama, LM Studio)
§ 67. Task-to-Model Routing Logic
§ 68. Cost-Optimal Routing
§ 69. Fallback Chains
§ 70. Context Transfer Between Models

## BOOK VII — AGENT ORCHESTRATION ENGINE
§ 71. The Conductor Service (master orchestrator)
§ 72. Agent Lifecycle Management
§ 73. Task Queue & Priorities
§ 74. Parallel Agent Coordination
§ 75. Agent-to-Agent Communication
§ 76. Shared Context Store (across agents)
§ 77. Task Handoff Protocol
§ 78. Work Stealing & Load Balancing

## BOOK VIII — SECURITY & TRUST
§ 79. Zero-Trust Architecture Principles
§ 80. End-to-End Encryption Design
§ 81. Secret Management (never in-code policy)
§ 82. Device Authorization (certificate-based)
§ 83. Command Signing
§ 84. Audit Trail (immutable log)
§ 85. Kill-Switch Mechanisms
§ 86. Incident Response Runbook
§ 87. Compliance Preparation (SOC2, GDPR future)

## BOOK IX — OBSERVABILITY
§ 88. Logging Standards (structured, searchable)
§ 89. Metrics Catalog (every metric we track)
§ 90. Distributed Tracing (follow request across services)
§ 91. Alert Rules (what pages Akmal)
§ 92. Dashboards (real-time operations view)
§ 93. Error Tracking (Sentry integration)
§ 94. User Behavior Analytics
§ 95. Performance Benchmarks

## BOOK X — COST INTELLIGENCE
§ 96. Token Tracking (per agent, per task, per user)
§ 97. Cost Attribution Model
§ 98. Budget Enforcement
§ 99. "Could have saved" Analysis
§ 100. Weekly Cost Reports
§ 101. Provider Cost Comparison Engine
§ 102. Optimization Recommendations

## BOOK XI — DEPLOYMENT & OPERATIONS
§ 103. Infrastructure-as-Code (Terraform)
§ 104. CI/CD Pipeline (GitHub Actions)
§ 105. Environment Strategy (dev, staging, production)
§ 106. Database Migration Strategy
§ 107. Rollback Procedures
§ 108. Disaster Recovery Plan
§ 109. On-Call Runbook
§ 110. SLA Definitions

## BOOK XII — QUALITY ASSURANCE
§ 111. Testing Philosophy
§ 112. Unit Test Coverage Targets
§ 113. Integration Test Suite
§ 114. End-to-End Test Scenarios
§ 115. Load Testing Strategy
§ 116. Security Testing (SAST, DAST)
§ 117. Manual QA Checklist (pre-release)
§ 118. Beta User Testing Protocol

## BOOK XIII — LAUNCH & GROWTH
§ 119. Beta Program (first 10 users)
§ 120. Public Launch Strategy
§ 121. Product Hunt Launch Plan
§ 122. Content Calendar (blog, twitter, linkedin)
§ 123. Demo Video Production
§ 124. Landing Page Requirements
§ 125. Pricing Page Design
§ 126. Onboarding Flow (first-time user)

## BOOK XIV — EXECUTION PLAN
§ 127. 6-Week Sprint Breakdown
§ 128. Week 1: Foundation & Security
§ 129. Week 2: Desktop Agent v1
§ 130. Week 3: Mobile App Core
§ 131. Week 4: GitHub Integration
§ 132. Week 5: Multi-Agent + AI Router
§ 133. Week 6: Polish + Demo + Launch
§ 134. Parallel Workstreams (which Claude does what)
§ 135. Daily Standup Format
§ 136. Milestone Gates (what "done" means at each phase)

## BOOK XV — OPERATIONAL RULES
§ 137. Rules R1-R50 for Claude Code Agents
§ 138. Git Workflow & Branching Strategy
§ 139. Code Review Policy (solo founder mode)
§ 140. Documentation Standards
§ 141. Secret Handling Protocol
§ 142. Incident Response
§ 143. Communication Protocols (how Claude reports to Akmal)


═══════════════════════════════════════════════════════════════════════════════
BOOK I — VISION & FOUNDATION
═══════════════════════════════════════════════════════════════════════════════

§ 1. EXECUTIVE SUMMARY

Operator-OS is the first Primary AI Control Platform: a mobile-first system
that lets a single founder command a swarm of AI agents running on their
computers, from anywhere in the world.

One remote for:
  • All your AI tools (Claude, Codex, GPT, Gemini, local models)
  • All your computers (Windows, Mac, Linux)
  • All your workflows (code, content, research, ops)
  • All from your phone

The killer scenario: founder in an Uber. Taps phone. Says "fix the auth bug
and deploy". Arrives home. Product is already deployed. CI is green. PR is
merged.

This is not an AI chat app. This is not a remote desktop. This is not an
IDE. This is infrastructure for a founder's life.

═══════════════════════════════════════════════════════════════════════════════

§ 2. THE PROBLEM WE SOLVE

## The modern founder's reality (2026)

A single founder building a SaaS product today uses:
  • 2-4 coding AI tools (Claude Code, Cursor, Codex, Copilot)
  • 3-5 content AI tools (Claude chat, GPT, Midjourney, Nano Banana, ElevenLabs)
  • 2-3 research AI tools (Perplexity, Gemini Deep Research)
  • Multiple machines (desktop, laptop, possibly a server)
  • 10+ SaaS subscriptions ($500-2000/month on AI alone)

## The pain

1. Context fragmentation
   Every tool has its own chat history. No memory between tools.
   Copy-paste between Claude and GPT. Re-explain the codebase every time.

2. Local lock-in
   Claude Code runs in your terminal. You leave the desk to work stops.
   No way to delegate from phone.
   Can't check if agent finished the task while away.

3. Mobile is a second-class citizen
   AI mobile apps are chat-only. No way to do real work.
   No way to approve PRs on phone. No way to trigger deploys.
   Founder becomes chained to desk.

4. No coordination
   You want 3 agents working in parallel? You manually open 3 terminals.
   You want them to share context? You copy-paste between them.
   You want to see what all 3 are doing? You tab between windows.

5. Cost opacity
   How much did you spend on Claude this month? You don't know until bill arrives.
   Which task cost the most? No way to tell.
   Are you wasting tokens on bad prompts? No feedback loop.

6. No single source of truth
   Work happens across 5 surfaces (Claude desktop, Claude Code, ChatGPT,
   Cursor, phone). Nothing connects them. Nothing remembers across them.

## The cost of this pain

Time: Founder loses 2-4 hours/day to context switching and mobile-unfriendly
workflows. Over a month, that's a week.

Money: Fragmented tool subscriptions cost 3-5x what unified platform would.

Quality: Decisions are made with fragmented context. Bugs are caused by
information loss between tools.

Psychology: Founder feels tethered to desk. Can't take vacation. Can't
step away. This is unsustainable.

═══════════════════════════════════════════════════════════════════════════════

§ 3. THE CATEGORY WE CREATE

Operator-OS creates a new category: **Primary AI Control Platform** (PACP).

## What exists today (adjacent categories)

| Category              | Example           | What they do                |
|-----------------------|-------------------|-----------------------------|
| AI-first IDE          | Cursor, Zed       | AI inside code editor       |
| Terminal AI           | Claude Code       | Agent in terminal           |
| Chat AI               | ChatGPT, Claude   | Conversational interface    |
| Remote desktop        | TeamViewer, RDP   | Screen sharing              |
| Workflow automation   | Zapier, n8n       | Integrations without AI     |
| Agent platforms       | AutoGPT, CrewAI   | Multi-agent frameworks      |

## What PACP is (our category)

A Primary AI Control Platform is:
  • The single surface through which a user commands all AI tools
  • Mobile-first (phone is primary, desktop secondary)
  • Device-aware (knows which PCs user has, their state)
  • Agent-aware (knows which agents are running, what they're doing)
  • Context-unified (all AI tools share one memory layer)
  • Cost-aware (tracks every token across every provider)
  • Trust-first (no stealth operations, everything visible)

## Why nobody has built this yet

Technical difficulty:
  • Requires mobile + desktop + cloud all working together
  • Requires agent orchestration (hard)
  • Requires multi-provider abstraction (hard)
  • Requires real-time streaming at scale (hard)

Market timing:
  • Claude Code only launched 2024
  • Multi-agent coordination only practical since Opus 4
  • Mobile AI was chat-only until late 2025
  • Founder "agent overload" problem only became critical in 2026

Founder-market fit:
  • Requires solo founder who actually lives this pain
  • Requires technical chops (mobile + backend + AI)
  • Requires design sense (mobile UX is hard)
  • Requires conviction (no playbook exists)

Akmal has all three. This is the window.

## Category strategy

Lesson from history:
  • Figma created "collaborative design" category
  • Linear created "fast issue tracker" category
  • Notion created "flexible workspace" category
  • Cursor created "AI-native IDE" category

All of them:
  1. Started with ONE killer scenario (not many)
  2. Owned the vocabulary of their category
  3. Built deep moat before competitors copied surface

Operator-OS playbook:
  1. Killer scenario: "Deploy from your Uber"
  2. Own vocabulary: PACP, Operator, Conductor, Agent Swarm
  3. Deep moat: multi-device + multi-AI + mobile-first simultaneity

═══════════════════════════════════════════════════════════════════════════════

§ 4. THE 5 ARCHITECTURAL LAWS

These are non-negotiable. Every feature must pass all 5. Every design
decision must honor all 5. Every tradeoff must not violate any of them.

## LAW #1 — Trusted / Visible / No-Stealth

Every action the system takes on user's machines is visible to the user.

Concretely:
  • No hidden background operations
  • No "the agent did something you can't see"
  • Every command has a log entry
  • Every file touched is recorded
  • User can see in real-time what agents are doing
  • User can kill any operation at any time
  • User can audit full history

Contrast: TeamViewer lets someone take over your screen. We don't do that.
We show exactly what we're doing, and user approves or stops.

Implementation implications:
  • Desktop agent logs every subprocess it starts
  • Mobile app can stream live output of any agent
  • Backend audit log is immutable
  • Every command requires explicit or pre-authorized user consent

## LAW #2 — User Sovereignty

The user owns everything: their data, their context, their agents, their
money spent.

Concretely:
  • User can export all their data at any time
  • User can delete account and everything gets purged
  • User controls which AI providers are used
  • User sets budgets, we enforce them
  • User owns their prompts, contexts, conversations
  • We never train on user data (privacy-first)
  • User can run system on their own infrastructure (enterprise)

Contrast: ChatGPT/Claude own your conversation history. We don't. You do.

Implementation implications:
  • All user data encrypted at rest with user-controlled key option
  • Export API for everything
  • Hard delete on account termination
  • No data shared between users without explicit consent

## LAW #3 — Multi-AI Agnostic

No vendor lock-in. Operator-OS is a Universal AI Control Platform,
not a Claude Code remote. Claude Code is the Phase 1 MVP proof; the
product controls any AI agent the founder chooses to run.

Concretely:
  • Claude (Claude Code CLI, Claude chat), OpenAI (Codex CLI, GPT
    chat, ChatGPT desktop), Google (Gemini CLI), Cursor CLI,
    Copilot Workspace, local models (Ollama, LM Studio), and future
    AI tools — all interchangeable, all first-class
  • User can switch agents mid-task and mid-session
  • Context is stored in our format, translatable to any agent
  • Pricing and usage displayed in real-time per vendor
  • No "this only works with Claude" features
  • Every architectural decision must pass the test: "Will this
    still work when Codex lands in 2 weeks, without a rewrite?"

Contrast: Cursor locks you into their AI backend. We don't.

Implementation implications — this law is implemented via **four
provider-agnostic interfaces** that all agent-aware code must go
through. Concrete agent classes (e.g. `ClaudeCodeAgent`) are never
referenced from Desktop Agent core, the backend command dispatcher,
the mobile UI, or the conductor; they are loaded via a provider
registry at runtime.

  • `AIAgent` — any AI coding/task agent. Lifecycle
    (`initialize`, `shutdown`), execution (`execute`, `stream`,
    `cancel`), state (`status`, `resourceUsage`). Every concrete
    agent — `ClaudeCodeAgent`, `CodexAgent`, `CursorCLIAgent`,
    `OllamaAgent`, etc. — implements this.
  • `FileSystemProvider` — any file access. Abstracts over local
    FS, SSH remote, cloud workspace, sandboxed containers. Agents
    never call `fs.readFile` directly.
  • `StreamProvider` — any output streaming transport (subprocess
    PTY, SSE, WebSocket, queue fan-out). Decouples "where output
    comes from" from "how the UI consumes it".
  • `CostProvider` — vendor-specific usage + pricing surface.
    Records usage events, estimates task cost, exposes current
    pricing tables. One implementation per vendor.

See § 61 for the full interface specifications, § 27.5 for the
provider registry on Desktop Agent, and § 62-66.7 for the concrete
agent implementations that ship with v1 and that are planned for
later phases.

## LAW #4 — Security-First

Security is not a layer added later. It's the foundation.

Concretely:
  • Zero-trust: every request authenticated, every device authorized
  • End-to-end encryption for commands
  • Secrets never in code, logs, or URLs
  • Audit trail immutable (append-only)
  • Principle of least privilege (every service has minimal IAM)
  • Defense in depth (multiple layers)

Contrast: Many AI tools leak API keys, send data unencrypted, or store
secrets in plain text. We don't.

Implementation implications:
  • OIDC + mTLS between services
  • Google Secret Manager for all credentials
  • Cloud Armor for DDoS protection
  • Regular security audits
  • Incident response plan (§ 86)

## LAW #5 — Verifiable Honesty

The system never lies about its state. If something is broken, it says so.
If something is partially working, it says exactly what works and what doesn't.

Concretely:
  • /ready endpoint reports true state (not "optimistic" state)
  • Error messages are specific and actionable
  • Progress indicators reflect actual progress (no fake "90%")
  • Cost estimates are honest (not marketing numbers)
  • Capability claims match reality

Contrast: Many SaaS products show "operational" status when they're degraded.
We don't. We show degraded when degraded.

This is the law that P0.1 closure was about.

Implementation implications:
  • Every component has honest /ready semantics
  • Error taxonomy (what each error actually means)
  • Status page shows real state
  • Release notes accurate

═══════════════════════════════════════════════════════════════════════════════

§ 5. TARGET USERS & PERSONAS

## Primary Persona: "Parallel Founder" (Akmal himself)

Profile:
  • Solo founder, 1-3 years into a product
  • Technical background (can code)
  • Uses 3+ AI tools daily
  • Multiple machines (desktop at home, laptop for travel)
  • Works non-traditional hours (often late night, weekends)
  • Ships fast, iterates
  • Spends $200-2000/month on AI tools

Pain points:
  • Tethered to desk by Claude Code
  • Can't delegate tasks when away
  • Loses context switching between AI tools
  • Can't check on running tasks from phone
  • Wants to approve PRs from Uber

Success metric:
  • Can run full development day from phone
  • Delegates 50%+ of routine work to agents
  • Feels ownership of dev process from anywhere

## Secondary Persona: "Multi-Agent Power User"

Profile:
  • Technical PM or engineering manager
  • Leads team but wants to code/build themselves
  • Uses Claude Code + Cursor + ChatGPT
  • Travel-heavy role
  • Spends $500-3000/month on AI

Pain points:
  • Needs to coordinate work across trips
  • Wants to launch multiple agents on research tasks
  • Needs cost visibility across team

Success metric:
  • Orchestrates 5+ agents working in parallel
  • Gets weekly cost breakdown
  • Team adoption possible (future team plan)

## Tertiary Persona: "AI-First Consultant"

Profile:
  • Independent consultant or fractional CTO
  • 3-5 client codebases to juggle
  • Uses AI for everything
  • Location-independent work style

Pain points:
  • Context switching between client codebases
  • Hard to delegate to junior AI agents
  • Needs audit trail for client invoicing

Success metric:
  • Separate "rooms" per client with isolated context
  • Agent time logs for client billing
  • Secure delegation to agents

## Non-Users (explicitly NOT targeting MVP)

  • Non-technical users (we're power-user first)
  • Large enterprises (no SOC2 yet)
  • Team of 10+ (team features Phase 3)
  • Hobbyists (we're priced for professionals)
  • Students (free tier not generous enough for learning)

═══════════════════════════════════════════════════════════════════════════════

§ 6. COMPETITIVE LANDSCAPE

## Direct competitors: None

No product today does mobile-first control of agent swarms on user's PCs.
We are creating the category.

## Adjacent competitors & how we differ

### Cursor (AI-IDE)
They own: Code editing with AI
We own: Control plane above all AI tools, mobile-first
Moat difference: They're locked to desktop IDE. We work from anywhere.

### Claude Code (Agent in terminal)
They own: Terminal AI coding experience
We own: Orchestration of multiple Claude Code instances + other agents
Moat difference: They're single-agent, desktop-only. We're multi-agent, mobile.
Potential partnership: Anthropic could acquire or integrate us.

### GitHub Copilot Workspace
They own: GitHub-native coding assistant
We own: Cross-GitHub multi-agent workflows
Moat difference: They're repo-specific. We're founder-specific.

### ChatGPT/Claude mobile apps
They own: Mobile chat with AI
We own: Mobile control of AI agents doing real work
Moat difference: They're chat-only on mobile. We execute real tasks.

### Replit Agent
They own: Web-based AI coding in their environment
We own: Control of user's own machines (not ours)
Moat difference: They own the compute. User owns it with us.

### Zapier/Make/n8n
They own: Workflow automation without AI-first UX
We own: Agent orchestration with AI-first UX
Moat difference: They connect SaaS APIs. We command living agents.

### TeamViewer/RustDesk
They own: Remote screen access
We own: Agent-mediated remote work (no screen sharing needed)
Moat difference: They show you the screen. We do the work for you.

## Why we'll win

1. Mobile-first is a platform choice, not a feature
   Competitors bolt on mobile apps. We design mobile-first.

2. Multi-agent is an architectural choice, not a feature
   Competitors are single-agent. We coordinate swarms.

3. Provider-agnostic is a principle, not marketing
   Competitors lock you in. We liberate.

4. Founder-aware design
   We know what solo founders need because Akmal IS one.

5. Speed of execution
   AI-native development = we ship in weeks what took years.

═══════════════════════════════════════════════════════════════════════════════

§ 7. BUSINESS MODEL & PRICING

## Tiers

### Free Tier
  • 1 connected PC
  • 1 AI provider (Claude OR GPT OR Gemini, user picks one)
  • 100 commands/month
  • 7-day history retention
  • Community support only
  • No priority queue

Goal: Conversion funnel. Not a viable use case, a teaser.

### Pro ($29/month)
  • Unlimited connected PCs (reasonable fair-use)
  • All AI providers simultaneously
  • Unlimited commands
  • 90-day history
  • Priority queue
  • Mobile + desktop apps
  • Email support
  • Usage analytics

Goal: Solo founder primary offering. Target 10,000 subscribers = $290k MRR.

### Team ($79/user/month)
  • Everything in Pro
  • Shared agents across team
  • Role-based access control
  • Audit log per user
  • Usage analytics per user
  • SSO (Google, Okta)
  • Team Slack integration
  • Priority support (response SLA)

Goal: Post-launch. Year 2 offering.

### Enterprise (custom pricing, starting $2000/month)
  • Self-hosted option
  • SOC 2 compliance
  • Custom SLAs
  • Dedicated support
  • Private deployment
  • Compliance audit trails
  • Custom integrations

Goal: Year 3+.

## Add-ons

### AI Credits
  • Pro includes: enough Claude/GPT usage for ~8 hours/day coding
  • Beyond that: $0.50/credit where 1 credit = ~10k tokens
  • Users can bring their own API keys (BYOK) for transparency

### Extra PCs beyond fair use (10+): $5/PC/month

### Priority compute (faster response times): $10/month

## Revenue Projections (conservative)

### Month 6 (MVP + 3 months iteration)
  • 200 Pro users × $29 = $5,800 MRR
  • Costs: ~$2,000/month
  • Net: $3,800 MRR

### Month 12
  • 1,000 Pro users × $29 = $29,000 MRR
  • 10 Team accounts × $400 avg = $4,000 MRR
  • Total: $33,000 MRR
  • Costs: ~$8,000/month
  • Net: $25,000 MRR

### Month 24
  • 10,000 Pro = $290,000 MRR
  • 200 Team = $80,000 MRR
  • 5 Enterprise = $25,000 MRR
  • Total: $395,000 MRR = $4.74M ARR
  • Costs: ~$80,000/month
  • Net: $315,000 MRR

### Year 3 goal: $10M ARR

═══════════════════════════════════════════════════════════════════════════════

§ 8. SUCCESS METRICS

## North Star Metric

Daily Active Founders Executing Tasks From Mobile (DAF-mobile)

This captures:
  • Daily active (real usage)
  • Founders (our target)
  • Executing tasks (not just viewing)
  • From mobile (our differentiator)

Target trajectory:
  • End Week 6 (demo): 1 (Akmal)
  • End Month 3: 10 (beta)
  • End Month 6: 100 (public launch)
  • End Month 12: 1,000
  • End Month 24: 10,000

## Leading Indicators

### Product health
  • Commands executed per user per day (target: 10+)
  • Ratio of mobile-initiated vs desktop-initiated (target: 60%+ mobile)
  • Agent coordination events per day (multi-agent usage)
  • Task success rate (target: 95%+)
  • Mean time to task completion (target: < 5 min simple, < 30 min complex)

### User engagement
  • DAU/MAU ratio (target: 40%+)
  • Session length from mobile (target: 5+ min)
  • Notifications opened rate (target: 60%+)
  • Voice input usage (target: 20%+)

### Business health
  • Free → Pro conversion (target: 5%)
  • Pro churn (target: < 3% monthly)
  • NPS (target: 50+)
  • Organic vs paid acquisition ratio (target: 70% organic)

## Lagging Indicators

### Revenue
  • MRR growth (target: 15-20% month-over-month Year 1)
  • ARPU (target: $30+ Year 1, $50+ Year 2)
  • LTV:CAC ratio (target: 3:1+)

### Technical health
  • Uptime SLA (target: 99.9%)
  • P95 API latency (target: < 500ms)
  • Error rate (target: < 0.5%)
  • Cost per active user (target: 30% of ARPU)

## Anti-metrics (what NOT to optimize for)

  • Time spent in app (we want speed, not stickiness)
  • Message volume (we want efficient agents, not chatty)
  • Feature count (we want depth, not breadth)
  • Screen count in mobile app (we want focus)

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK II — SYSTEM ARCHITECTURE
═══════════════════════════════════════════════════════════════════════════════

§ 9. HIGH-LEVEL ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USER DEVICES LAYER                                 │
│                                                                             │
│  📱 Mobile App               💻 Desktop Agent         🌐 Web Dashboard      │
│  (React Native)              (Node.js + Electron      (Next.js, future)     │
│  - iOS                        shell optional)                               │
│  - Android                   - Windows                                      │
│                              - macOS                                        │
│                              - Linux                                        │
└────────────┬────────────────────────┬──────────────────────┬────────────────┘
             │ HTTPS                  │ WSS + HTTPS          │ HTTPS
             │ WSS                    │                      │
             ▼                        ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EDGE LAYER (Google Cloud Load Balancer)              │
│                                                                             │
│  • Cloud Armor (DDoS, rate limiting)                                        │
│  • TLS termination                                                          │
│  • Routing to services                                                      │
│  • Geographic load balancing                                                │
└────────────┬────────────────────────┬──────────────────────┬────────────────┘
             │                        │                      │
             ▼                        ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND SERVICES LAYER                             │
│                          (Cloud Run, europe-west4)                          │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ operator-api │  │ conductor    │  │ streamer     │  │ auth-gateway │    │
│  │ (existing)   │  │ (new)        │  │ (new)        │  │ (new)        │    │
│  │              │  │ Orchestrator │  │ WebSocket    │  │ OIDC + JWT   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ notifications│  │ cost-tracker │  │ audit-logger │  │ ai-router    │    │
│  │ (new)        │  │ (new)        │  │ (new)        │  │ (new)        │    │
│  │ Push + email │  │ Tokens + $   │  │ Immutable    │  │ Multi-LLM    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└────────────┬────────────────────────┬──────────────────────┬────────────────┘
             │                        │                      │
             ▼                        ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA & MESSAGING LAYER                              │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Firestore    │  │ Cloud Pub/Sub│  │ Cloud Tasks  │  │ Cloud Storage│    │
│  │ User data    │  │ Event bus    │  │ Delayed jobs │  │ Artifacts    │    │
│  │ Agents       │  │ Streaming    │  │ Retries      │  │ Logs archive │    │
│  │ Tasks        │  │              │  │              │  │              │    │
│  │ History      │  │              │  │              │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │ Secret Mgr   │  │ BigQuery     │  │ Cloud Logging│                      │
│  │ API keys     │  │ Analytics    │  │ Structured   │                      │
│  │ Tokens       │  │ Metrics DWH  │  │ Searchable   │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
             │                        │                      │
             ▼                        ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL PROVIDERS                                  │
│                                                                             │
│  • Anthropic API (Claude)                                                   │
│  • OpenAI API (GPT-5, Codex)                                                │
│  • Google AI (Gemini, Nano Banana Pro)                                      │
│  • GitHub API                                                               │
│  • Stripe (billing)                                                         │
│  • Firebase Cloud Messaging (push notifications)                            │
│  • APNs (iOS push)                                                          │
│  • Twilio (SMS fallback, future)                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

═══════════════════════════════════════════════════════════════════════════════

§ 10. COMPONENT INVENTORY

## Mobile App Components

### apps/mobile (React Native + Expo)
Technology: React Native 0.75+, Expo SDK 52+, TypeScript strict
Purpose: Primary user interface for founders
Key libraries:
  • @react-navigation/native — navigation
  • zustand — state management (not Redux, too heavy)
  • react-native-reanimated — animations
  • react-native-gesture-handler — gestures
  • react-native-mmkv — fast local storage
  • react-native-voice — voice input
  • expo-notifications — push notifications
  • react-native-websocket — WebSocket client
  • expo-secure-store — secure token storage
  • @tanstack/react-query — server state
  • react-native-svg — vector graphics
  • expo-haptics — tactile feedback

## Desktop Agent Components

### apps/desktop-agent (Node.js service)
Technology: Node.js 20 LTS, TypeScript strict, Fastify
Purpose: Background service on user's PC executing commands

Packaged as:
  • Windows: NSIS installer → Windows Service
  • macOS: pkg installer → LaunchAgent
  • Linux: .deb/.rpm → systemd service

Key libraries:
  • fastify — local HTTP server (localhost only)
  • ws — WebSocket client for backend
  • node-pty — pseudo-terminal for subprocess stdio
  • chokidar — file system watching
  • node-windows / node-mac — service integration
  • keytar — OS keychain access
  • systeminformation — resource monitoring
  • pino — structured logging
  • undici — HTTP/2 client for backend

### apps/desktop-tray (optional Electron shell)
Technology: Electron 30+
Purpose: System tray icon, settings UI
Size: < 50MB packaged
Only needed for rich settings UI; core agent runs without it.

## Backend Services

### apps/api (existing, operator-os-api)
Purpose: Primary REST API (auth, users, tasks metadata)
Technology: Fastify, TypeScript, Zod
Endpoints growing from current P0.1 state to full catalog in § 18

### apps/conductor (NEW)
Purpose: Orchestrates multi-agent workflows
Technology: Fastify, TypeScript
Key responsibilities:
  • Route tasks to agents based on capability + availability
  • Coordinate parallel agents on shared goal
  • Handle task dependencies
  • Manage agent lifecycles (spawn, suspend, kill)

### apps/streamer (NEW)
Purpose: Real-time streaming between desktop agents and mobile
Technology: Fastify + WebSocket (ws library)
Key responsibilities:
  • Maintain persistent WebSocket connections per device
  • Stream subprocess output from desktop agent to mobile
  • Handle reconnection on mobile (flaky networks)
  • Backpressure when consumer slower than producer

### apps/auth-gateway (NEW)
Purpose: Centralized authentication and device authorization
Technology: Fastify, OIDC provider, JWT
Key responsibilities:
  • User sign-in (Google OAuth initially, more providers later)
  • Device registration (mobile pairs with backend, PC pairs with user)
  • JWT issuance with proper scopes
  • Session management
  • Refresh token rotation

### apps/notifications (NEW)
Purpose: Multi-channel notifications (push, email, in-app)
Technology: Fastify, Firebase Admin SDK, SendGrid
Key responsibilities:
  • Push notifications to iOS (APNs) and Android (FCM)
  • Email for critical events (beyond push)
  • In-app notification center
  • User preference management

### apps/cost-tracker (NEW)
Purpose: Track every token and dollar across all AI providers
Technology: Fastify, BigQuery for analytics
Key responsibilities:
  • Ingest token usage events from all services
  • Convert tokens → dollars per provider pricing
  • Maintain real-time budget state per user
  • Generate weekly/monthly cost reports
  • Provide "could have saved" analysis (§ 99)

### apps/audit-logger (NEW)
Purpose: Immutable audit trail of every system action
Technology: Fastify, Firestore with special rules
Key responsibilities:
  • Receive audit events from all services
  • Store with cryptographic hash chain (tamper-evident)
  • Provide search and export API
  • Retention per user plan (Pro: 90 days, Enterprise: custom)

### apps/ai-router (NEW)
Purpose: Multi-LLM abstraction layer (see BOOK VI)
Technology: Fastify, provider SDKs
Key responsibilities:
  • Unified interface to Claude, GPT, Gemini, local models
  • Routing logic (task → best provider)
  • Fallback chains on provider failure
  • Cost optimization (cheapest viable provider)
  • Context translation between providers

## Shared Packages

### packages/contracts
Zod schemas shared across all services and mobile app
Every API request/response, every Pub/Sub message, every Firestore doc

### packages/sdk-client
TypeScript client SDK used by mobile + desktop agent
Generated from contracts, ensures type safety

### packages/common-types
Shared TypeScript types (Command, Agent, Task, User, etc.)

### packages/event-bus
Wrapper around Pub/Sub with typed publish/subscribe

### packages/logger
Structured logger (Pino) with standard fields

### packages/error-taxonomy
Standardized error classes + codes across system

### packages/auth-primitives
JWT verification, OIDC helpers, key rotation utilities

### packages/device-registry
Client library for interacting with device/agent registry

### packages/prompts
Versioned prompt library (per use case, per AI provider)

### packages/ui-components (mobile-specific)
Reusable React Native components
Design system primitives (Button, Card, etc.)

═══════════════════════════════════════════════════════════════════════════════

§ 11. DATA FLOW: END-TO-END JOURNEY

Let's trace a real command from phone tap to execution result.

## Scenario: Fix auth bug on home PC

Akmal is in an Uber. He taps his phone. Here's every step.

### T+0ms: User Action
User taps "New Task" on mobile app home screen.

### T+20ms: Mobile Task Composer Opens
Screen transition animates in.
Recent PCs list loads from local cache (MMKV).
Default PC ("Home PC") selected.

### T+2000ms: User Describes Task
User taps microphone icon.
Speaks: "On home PC Claude Code one, fix the typescript error in
mobile auth tests, commit atomically, push to feat/auth-fix, open PR."

### T+5000ms: Voice Transcription Complete
iOS Speech Framework returns transcript.
Mobile app shows text in editable box.
User reviews, taps "Send".

### T+5100ms: Mobile Validates Locally
  • Task description length check (< 2000 chars)
  • PC selection validation (must be registered + online)
  • Agent slot check (which Claude Code instance)
  • Returns to user with "Sending..." state

### T+5200ms: Mobile → Backend Request
POST https://api.operator-os.com/v1/tasks
Headers:
  Authorization: Bearer <JWT>
  X-Device-Id: <mobile-device-uuid>
  X-Trace-Id: <request-uuid>
Body (Zod-validated):
  {
    "targetPc": "pc-uuid-home",
    "targetAgent": "claude-code-1",
    "description": "fix typescript error...",
    "priority": "normal",
    "metadata": {
      "origin": "mobile-voice",
      "clientTime": "2026-04-22T..."
    }
  }

### T+5250ms: Edge Layer
Cloud Load Balancer receives request.
Cloud Armor checks rate limit (per user: 60 req/min).
Routes to operator-api service.

### T+5300ms: API Validates & Creates Task
operator-api:
  1. Verifies JWT with auth-gateway (cached 5 min)
  2. Loads user from Firestore
  3. Verifies PC registered to this user
  4. Verifies agent exists on that PC
  5. Creates Task in Firestore:
     tasks/{taskId}/
       id: "task-uuid"
       userId: "akmal-uuid"
       pcId: "pc-uuid-home"
       agentId: "claude-code-1"
       description: "..."
       status: "pending"
       createdAt: timestamp
       ...
  6. Publishes to Pub/Sub: "task.created" topic
  7. Returns 201 Created with task ID to mobile

### T+5400ms: Mobile Updates UI
Mobile receives task ID.
Navigates to Task Detail screen.
Shows "Queued on Home PC → Claude Code 1"
Starts listening to WebSocket for task updates.

### T+5500ms: Conductor Picks Up Event
conductor service subscribed to "task.created".
Receives event, fetches full task from Firestore.
Determines routing:
  • Target PC: home-pc → check if online via recent heartbeat
  • Target agent: claude-code-1 → check capacity
  • All clear → dispatch

### T+5600ms: Conductor → Streamer
conductor publishes "task.dispatch" to Pub/Sub.
streamer service receives it.
streamer looks up WebSocket connection for home-pc.
  If home-pc has active WebSocket → send command directly.
  If not → put command in pending queue (desktop agent polls when reconnects).

### T+5700ms: Desktop Agent Receives Command
desktop agent on home-pc listening on WebSocket.
Receives message:
  {
    "type": "command.execute",
    "commandId": "cmd-uuid",
    "taskId": "task-uuid",
    "agentType": "claude-code",
    "agentSlot": 1,
    "instruction": "fix typescript error...",
    "workingDir": "D:\Operator-OS-Dev",
    "timeout": 1800,
    "permissions": { ... }
  }

### T+5800ms: Desktop Agent Starts Execution
desktop agent:
  1. Validates command signature (ensure really from backend)
  2. Checks if Claude Code slot 1 is available
  3. Prepares environment:
     - Sets CWD
     - Injects env vars from user's profile
     - Connects to Anthropic API (via user's Claude Max auth)
  4. Spawns subprocess via node-pty:
     claude --continue --prompt "fix typescript error in mobile auth tests..."
  5. Logs: local audit log + sends "command.started" to backend

### T+6000ms: Output Streaming Begins
Claude Code starts producing output.
desktop agent:
  • Captures stdout via node-pty
  • Chunks every 100ms or 4KB
  • Sends chunks via WebSocket:
    {
      "type": "command.output",
      "commandId": "cmd-uuid",
      "stream": "stdout",
      "chunk": "Reading mobile auth tests...",
      "seq": 1
    }

### T+6100ms: Streamer → Mobile
streamer forwards output chunks to mobile's WebSocket.
Mobile app receives chunks in Task Detail screen.
Displays as live terminal output.
Auto-scrolls.

### T+6500ms: Mobile Shows Progress
User sees:
  [T+1.5s] Reading mobile auth tests...
  [T+2.1s] Found error in auth.test.ts line 47
  [T+2.4s] Analyzing error...

### T+30000ms (30 seconds in): Claude Code Fixes
Claude Code:
  • Reads error
  • Identifies fix
  • Modifies auth.test.ts
  • Runs tests (also streamed)
  • Tests pass

### T+60000ms: Claude Code Commits
Claude Code runs:
  • git add auth.test.ts
  • git commit -m "fix(mobile): correct type signature in auth test"
  • git checkout -b feat/auth-fix
  • git push -u origin feat/auth-fix

### T+90000ms: PR Creation
Claude Code runs:
  gh pr create --base main --head feat/auth-fix \
    --title "fix(mobile): correct auth test type error" \
    --body "Fixes type error in auth.test.ts..."

PR created. PR URL output.

### T+92000ms: Command Complete
desktop agent:
  • Subprocess exits with code 0
  • Sends "command.complete":
    {
      "type": "command.complete",
      "commandId": "cmd-uuid",
      "exitCode": 0,
      "duration": 92000,
      "artifacts": {
        "prUrl": "https://github.com/.../pull/47",
        "commitSha": "abc123",
        "filesChanged": ["auth.test.ts"],
        "tokensUsed": 12847
      }
    }

### T+92100ms: Backend Records Completion
operator-api:
  • Updates task: status="completed", endedAt=now, ...
  • Writes cost event for cost-tracker
  • Writes audit log entry
  • Publishes "task.completed" to Pub/Sub

### T+92200ms: Notification Sent
notifications service:
  • Receives "task.completed"
  • Loads user preferences (push enabled for completions? yes)
  • Sends FCM message to mobile device:
    {
      "title": "Task complete",
      "body": "PR #47 opened on feat/auth-fix",
      "data": { "taskId": "...", "prUrl": "..." }
    }

### T+92500ms: Mobile Receives Notification
User's phone vibrates.
Notification shows:
  "Operator-OS: Task complete → PR #47 opened"

### T+93000ms: User Reviews PR
User taps notification.
Mobile app opens to Task Detail.
Shows "✅ Complete. PR #47 ready for review."
Button: [View PR]

User taps [View PR].
Mobile Diff Viewer opens (§ 49).
User reviews 3-line diff.
User taps [Approve & Merge].

### T+95000ms: Merge Command Sent
Mobile → Backend → Desktop Agent:
  gh pr review 47 --approve
  gh pr merge 47 --squash --delete-branch

### T+97000ms: Merge Complete
PR merged. CI kicks off on main.

### T+97100ms: User Arrives Home
Akmal opens door. Walks to PC. CI is green. Code is in main.
Total time from Uber to merged: 1 minute 37 seconds.

## Key observations

1. End-to-end latency is dominated by AI work (90s), not our infrastructure (< 500ms)
2. User sees updates every 100ms (feels real-time)
3. Every step is audit-logged
4. If any link breaks, user sees specific error
5. Commands are idempotent — retry safe

═══════════════════════════════════════════════════════════════════════════════

§ 12. COMMUNICATION PROTOCOLS

## Decision: WebSocket primary, SSE fallback, Polling last resort

### WebSocket (primary path)
Used for:
  • Mobile ↔ Backend (task updates, real-time UI)
  • Desktop Agent ↔ Backend (command reception, output streaming)

Why WebSocket:
  • Bi-directional (backend can push, client can push)
  • Low latency (< 50ms overhead)
  • Stateful connection (heartbeat easy)
  • Multiplex many event types on one connection

Protocol:
  wss://stream.operator-os.com/v1/stream

  Auth via JWT in Sec-WebSocket-Protocol header:
  `operator-os.v1, token.<jwt>`

Message format (JSON, Zod-validated):
  {
    "type": "...",        // message type discriminator
    "traceId": "...",     // for distributed tracing
    "ts": "2026-...",     // ISO timestamp
    "seq": 1234,          // monotonic per-connection sequence
    "payload": { ... }    // type-specific payload
  }

Heartbeat: ping every 30s, pong within 10s, disconnect if no pong.

Reconnection: exponential backoff (1s, 2s, 4s, 8s, max 60s).

### Server-Sent Events (SSE, fallback)
Used when WebSocket blocked (corporate firewalls).
One-way server → client (good for streaming output).
HTTP/2-friendly, uses standard EventSource API.

Endpoint: GET /v1/stream/sse?taskId=xxx&token=xxx

### Long Polling (last resort)
Only if both WebSocket and SSE blocked.
Used for pending commands when desktop agent reconnects after offline.

Endpoint: GET /v1/pc/{pcId}/pending-commands?wait=30
Holds connection open for up to 30s waiting for commands.

## Design principle: Degrade gracefully

Mobile app tries in order:
  1. WebSocket
  2. SSE
  3. Long polling (5s interval)

User never sees the degradation. Status subtle indicator only:
  🟢 Real-time (WebSocket)
  🟡 Delayed (SSE/polling)
  🔴 Offline (no connection possible)

═══════════════════════════════════════════════════════════════════════════════

§ 13. STATE MANAGEMENT ACROSS DEVICES

The challenge: User has mobile + desktop agent + possibly web. All show
same tasks. State must be consistent.

## Approach: Server-authoritative with optimistic local updates

### Server is source of truth
Firestore holds canonical state.
All mutations go through backend.
Backend validates → writes → publishes event.

### Clients are projections
Mobile keeps local cache for offline viewing.
Desktop agent keeps local state for running operations.
Both sync with server via events.

### Optimistic updates on mobile
When user creates task:
  1. Mobile immediately shows task in list (optimistic)
  2. Sends to backend
  3. If success: mobile updates with server-issued ID
  4. If failure: mobile shows error, allows retry

### Conflict resolution
Rare, because only one user per account (Pro tier).
Strategy: Last-write-wins on user-level data.
Strategy: Server authoritative on task state (no client can change without server).

### Real-time sync
When task status changes:
  1. Backend updates Firestore
  2. Publishes event to Pub/Sub
  3. Streamer service broadcasts via WebSocket
  4. All connected clients receive update
  5. Each client updates local state

═══════════════════════════════════════════════════════════════════════════════

§ 14. EVENT BUS DESIGN (Pub/Sub topology)

## Topics

### task.created
Published: when new task is created
Subscribers: conductor (routes), audit-logger, cost-tracker (prep budget)

### task.dispatched
Published: when task sent to desktop agent
Subscribers: streamer (notify mobile), audit-logger

### task.started
Published: when desktop agent begins execution
Subscribers: streamer, audit-logger, cost-tracker

### task.output.chunk
Published: each chunk of subprocess output
High volume (many per task)
Subscribers: streamer (immediate forward to mobile), archiver (batch store)

### task.completed
Published: successful task completion
Subscribers: notifications, cost-tracker, audit-logger, streamer

### task.failed
Published: task failed (error, timeout, killed)
Subscribers: notifications, audit-logger, streamer

### task.cancelled
Published: user cancelled task
Subscribers: conductor (stop agent), audit-logger

### device.registered
Published: new device connects
Subscribers: notifications (email user), audit-logger

### device.online
Published: device comes online (heartbeat resumes)
Subscribers: streamer (deliver pending), notifications

### device.offline
Published: device misses heartbeat > 90s
Subscribers: notifications (alert user), task dispatcher (reroute)

### user.budget.alert
Published: user approaches budget limit
Subscribers: notifications, task dispatcher (may pause new commands)

### system.error
Published: unexpected system errors
Subscribers: notifications (alert Akmal ops), audit-logger

## Subscription patterns

Every service uses pull subscriptions (not push).
Ack deadline: 60s.
Retry policy: exponential backoff, max 3 attempts, then DLQ.
DLQ topic: same name + ".dlq"

## Message format

All messages use standard envelope:
  {
    "id": "msg-uuid",
    "traceId": "req-uuid",
    "topic": "task.completed",
    "publishedAt": "2026-...",
    "publisher": "operator-api",
    "schemaVersion": 1,
    "payload": { ... }
  }

Payloads are versioned schemas in packages/contracts.
Backward-compatible changes: add optional fields.
Breaking changes: new topic name (task.completed.v2).

═══════════════════════════════════════════════════════════════════════════════

§ 15. OFFLINE-FIRST PRINCIPLES

Mobile app must be useful without connection.

## What works offline

- Browse recent tasks (cached)
- View task detail (cached)
- Read PR diffs that were opened recently
- Compose new task (queued for send when online)
- Review notifications (local)

## What requires online

- Send new task (queued if offline, sent on reconnect)
- Stream live output (obviously)
- Approve/merge PRs (queued with warning)

## Implementation

- Use react-query with persistent cache (MMKV)
- Every list has stale-while-revalidate
- Every action has queue-if-offline option
- Clear UI indicator when offline
- Auto-retry queued actions on reconnect

═══════════════════════════════════════════════════════════════════════════════

§ 16. SCALABILITY STRATEGY

## Principle: Scale up, then scale out

Phase 1 (MVP-1000 users): Single Cloud Run service per app type.
  - operator-api: 1-10 instances auto-scaling
  - streamer: 1-5 instances
  - conductor: 1-3 instances
  - Firestore: single region

Phase 2 (1000-10,000 users):
  - Add read replicas where needed
  - Multi-region for edge services (streamer)
  - CDN for static assets

Phase 3 (10,000+ users):
  - Dedicated Kubernetes for stateful services
  - Regional Firestore instances
  - Custom Cloud Load Balancer routing

## Bottlenecks to watch

1. WebSocket connections per streamer instance
   Limit: ~10k concurrent per instance
   Mitigation: horizontal scale streamer, sticky sessions

2. Firestore write throughput
   Limit: 10k writes/sec per database
   Mitigation: sharding by user ID, batching writes

3. Pub/Sub throughput
   Limit: very high, not a practical bottleneck
   Mitigation: none needed

4. AI provider rate limits
   Claude: per-account limits
   OpenAI: per-key limits
   Mitigation: BYOK (bring your own key), our keys as fallback

5. Cost scaling
   Cloud Run costs scale linearly with usage (good)
   Mitigation: reserved instances for baseline load

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK III — BACKEND (operator-os-api and new services)
═══════════════════════════════════════════════════════════════════════════════

§ 17. CURRENT STATE AUDIT

## What exists (as of end of P0.1)

- apps/api (operator-os-api) live on Cloud Run
- Health endpoints: /health (alive), /ready (honest degraded)
- AI routes: /v1/ai/* (currently anonymous - TD-005, fix in Week 1)
- Agent routes: /v1/agent/* (currently anonymous - TD-005)
- Internal tasks: /internal/tasks/commands|approvals|exports (stubs, 204)
- Firestore integration working
- Pub/Sub topics: basic (needs expansion)
- Cloud Tasks queues: 3 (commands, approvals, exports)
- IAM: service account per role, ADC working
- Secret Manager: basic secrets present
- Vertex AI integration: wired

## What's missing

- User authentication system
- Device registration
- Multi-tenancy (still single-user implicit)
- Streaming infrastructure (WebSocket service)
- Conductor service
- AI router service
- Cost tracking service
- Notifications service
- Audit logger service
- All the API endpoints in § 18

## Work required

- Add auth-gateway service → week 1
- Add required-auth to existing /v1/agent/* and /v1/ai/* → week 1
- Build streamer service → week 2
- Build desktop agent registration endpoints → week 2
- Build conductor service → week 3
- Build AI router service → week 5
- Build cost tracker service → week 5
- Build notifications service → week 4
- Build audit logger service → week 4

═══════════════════════════════════════════════════════════════════════════════

§ 18. REQUIRED NEW ENDPOINTS

Full catalog of every endpoint needed for MVP.
Each includes: method, path, auth level, request schema, response schema.

## Authentication

### POST /v1/auth/signin
Auth: none (this is how you get auth)
Request: { provider: "google", idToken: "..." }
Response: { accessToken, refreshToken, user: {...} }

### POST /v1/auth/refresh
Auth: refresh token
Request: { refreshToken: "..." }
Response: { accessToken, refreshToken }

### POST /v1/auth/signout
Auth: access token
Response: 204

## User Profile

### GET /v1/me
Auth: access token
Response: { user: {...}, subscription: {...}, usage: {...} }

### PATCH /v1/me
Auth: access token
Request: { displayName?, timezone?, preferences? }
Response: { user: {...} }

### DELETE /v1/me
Auth: access token + confirmation token
Response: 204 (triggers full user data deletion)

## Devices

### GET /v1/devices
Auth: access token
Response: { devices: [{ id, name, type, os, status, lastSeenAt, ...}] }

### POST /v1/devices/pair
Auth: access token
Request: { deviceType: "mobile" | "desktop", name?, metadata? }
Response: { pairingCode: "ABC-123", qrCodeUrl, expiresAt }

### POST /v1/devices/pair/complete
Auth: pairing code (not JWT)
Request: { pairingCode, deviceInfo: { os, version, capabilities } }
Response: { deviceToken: "...", deviceId: "..." }

### DELETE /v1/devices/:deviceId
Auth: access token
Response: 204 (revokes device token)

### POST /v1/devices/:deviceId/heartbeat
Auth: device token
Request: { resources: {...}, runningTasks: N, version: "x.y.z" }
Response: { ack: true, commands: [...] (pending if any) }

## PCs (desktop agents)

### GET /v1/pcs
Auth: access token
Response: { pcs: [{ id, name, status, agents: [...], ...}] }

### PATCH /v1/pcs/:pcId
Auth: access token
Request: { name?, displayColor?, allowedAgents? }
Response: { pc: {...} }

### GET /v1/pcs/:pcId/agents
Auth: access token
Response: { agents: [{ type, slot, status, currentTaskId? }] }

### POST /v1/pcs/:pcId/agents/:agentId/kill
Auth: access token
Response: 202 (kill signal sent, asynchronous)

## Tasks

### POST /v1/tasks
Auth: access token
Request: {
  pcId,
  agentId,  // or "auto" to let conductor decide
  description,
  priority?: "low" | "normal" | "high",
  timeout?,
  maxTokens?,
  metadata?
}
Response: { task: {...} }

### GET /v1/tasks
Auth: access token
Query: ?status=&pcId=&limit=&offset=&sort=
Response: { tasks: [...], total: N, hasMore: boolean }

### GET /v1/tasks/:taskId
Auth: access token
Response: { task: {...}, events: [...], artifacts: [...] }

### POST /v1/tasks/:taskId/cancel
Auth: access token
Response: 202

### GET /v1/tasks/:taskId/output
Auth: access token
Query: ?since=<seq>
Response: { chunks: [...], hasMore, nextCursor }

### POST /v1/tasks/:taskId/artifacts/:artifactId/download
Auth: access token
Response: signed URL (5 min expiry)

## AI Router

### POST /v1/ai/complete
Auth: access token
Request: {
  prompt,
  model?: "auto" | "claude-opus-4-7" | "gpt-5" | ...,
  context?,
  tools?,
  maxTokens?,
  temperature?
}
Response: { completion, tokensUsed, cost, modelUsed }

### GET /v1/ai/models
Auth: access token
Response: { models: [{ provider, name, pricing, capabilities }] }

### POST /v1/ai/estimate
Auth: access token
Request: { prompt, model? }
Response: { estimatedTokens, estimatedCost, alternatives: [...] }

## Cost & Usage

### GET /v1/usage
Auth: access token
Query: ?period=day|week|month&groupBy=provider|pc|agent|task
Response: { usage: {...}, breakdown: [...] }

### GET /v1/usage/analysis
Auth: access token
Response: {
  insights: [...],
  savingsOpportunities: [...],
  trends: [...]
}

### GET /v1/budgets
Auth: access token
Response: { budgets: [{ type, amount, period, alertThreshold }] }

### POST /v1/budgets
Auth: access token
Request: { type, amount, period, alertThresholds? }
Response: { budget: {...} }

### PATCH /v1/budgets/:budgetId
Auth: access token
Request: partial
Response: { budget: {...} }

### DELETE /v1/budgets/:budgetId
Auth: access token
Response: 204

## Notifications

### GET /v1/notifications
Auth: access token
Query: ?unread=bool&limit=
Response: { notifications: [...], unreadCount }

### POST /v1/notifications/:notifId/read
Auth: access token
Response: 204

### POST /v1/notifications/read-all
Auth: access token
Response: 204

### GET /v1/notifications/preferences
Auth: access token
Response: { channels: { push, email, inApp }, events: {...} }

### PATCH /v1/notifications/preferences
Auth: access token
Request: partial
Response: updated preferences

## GitHub Integration (proxied)

### GET /v1/integrations/github/status
Auth: access token
Response: { connected, accountName, scopes }

### POST /v1/integrations/github/connect
Auth: access token
Response: { oauthUrl }

### POST /v1/integrations/github/disconnect
Auth: access token
Response: 204

### GET /v1/integrations/github/prs
Auth: access token
Query: ?repo=&state=&limit=
Response: { prs: [{ ...github data enriched with our metadata }] }

### GET /v1/integrations/github/prs/:repo/:prNumber
Auth: access token
Response: { pr: {...}, files: [{...}], reviews: [...] }

### POST /v1/integrations/github/prs/:repo/:prNumber/review
Auth: access token
Request: { action: "approve" | "request_changes" | "comment", body? }
Response: { review: {...} }

### POST /v1/integrations/github/prs/:repo/:prNumber/merge
Auth: access token
Request: { method: "merge" | "squash" | "rebase", deleteBranch? }
Response: { merged: true, mergeCommitSha }

## Audit & History

### GET /v1/audit
Auth: access token
Query: ?from=&to=&type=&deviceId=&limit=
Response: { events: [...], nextCursor }

### GET /v1/audit/export
Auth: access token
Query: ?from=&to=
Response: signed URL to JSON export

## System / Health

### GET /health
Auth: none
Response: { status: "ok", version, uptime }

### GET /ready
Auth: none (but rate-limited)
Response: { status, checks: [...] } (honest per LAW #5)

### GET /version
Auth: none
Response: { service, version, gitSha, buildTime }

═══════════════════════════════════════════════════════════════════════════════

§ 19. AUTHENTICATION & AUTHORIZATION MODEL

## User authentication

### Provider: Google OAuth 2.0 (primary)
- User clicks "Sign in with Google" on mobile
- Google returns ID token
- Mobile sends ID token to POST /v1/auth/signin
- Backend verifies ID token with Google
- Backend creates/updates user record
- Backend issues access token (JWT) + refresh token

### Access token (JWT)
- Signed with RS256 (asymmetric, rotatable keys)
- Expiry: 1 hour
- Claims:
  - sub: user ID
  - iss: operator-os.com
  - aud: operator-os-api
  - iat, exp: timestamps
  - scopes: [...]
  - plan: "free" | "pro" | "team" | "enterprise"

### Refresh token
- Opaque random string stored in Firestore
- Expiry: 30 days
- Rotation on use (old refresh token invalidated)
- One active refresh token per device

## Device authentication

### Device tokens
- Issued during pairing flow
- Different from user JWT (more restricted)
- Long-lived (not rotated unless revoked)
- Contains: userId, deviceId, deviceType

### Pairing flow for mobile
1. User signs in via Google → gets access token
2. Mobile app is device — registered on first sign-in
3. Device token issued as part of sign-in response

### Pairing flow for desktop agent
1. User logs into mobile app
2. User taps "Pair new PC"
3. Mobile shows QR code + pairing code (e.g., "GH7K-8P2M")
4. User runs installer on PC
5. Installer prompts for code
6. Desktop agent POSTs code to /v1/devices/pair/complete
7. Backend issues device token
8. Desktop agent stores token in OS keychain
9. Desktop agent establishes WebSocket

## Authorization

### Scopes
- user:read, user:write
- tasks:read, tasks:write, tasks:cancel
- devices:read, devices:write, devices:pair
- ai:use (counts against quota)
- github:read, github:write (if integrated)
- admin:* (special, for future team roles)

### Plan-based feature gating
Middleware checks user.plan against feature flags:
- Free: basic scopes only
- Pro: all user scopes
- Team: includes shared resource scopes
- Enterprise: includes admin scopes

### Rate limiting
- Per-user rate limits in Redis (Cloud Memorystore)
- Different limits per endpoint + per plan
- 429 responses include Retry-After header

═══════════════════════════════════════════════════════════════════════════════

§ 20. MULTI-DEVICE USER IDENTITY

User has:
- 1 Google account (their identity)
- 1 mobile device (their primary interface)
- 1-N desktop agents (their computers)
- 0-1 web sessions (future)

All linked to same userId.
Each device has own deviceToken for its specific access.
User can see all devices, revoke any.

Firestore structure:
users/{userId}/
  profile: {...}
  subscription: {...}
devices/{deviceId}/
  userId: "...",
  type: "mobile" | "desktop" | "web",
  ...

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK IV — DESKTOP AGENT
═══════════════════════════════════════════════════════════════════════════════

§ 27. DESKTOP AGENT v1 SPECIFICATION

## Mission

A background service on user's PC that:
1. Connects to backend via secure WebSocket
2. Registers and heartbeats
3. Accepts commands from backend
4. Hosts `AIAgent` provider plugins (ClaudeCodeAgent in v1, plus
   any others the user has installed — Codex, Cursor CLI,
   ChatGPT desktop, Gemini CLI, Ollama, LM Studio, Copilot
   Workspace, or a custom one) and dispatches tasks through the
   `AIAgent` interface only. Core code branches on capabilities,
   never on vendor string.
5. Streams output back to backend via a `StreamProvider`
6. Accesses files via a `FileSystemProvider` (local FS for v1;
   SSH / cloud / sandbox providers in later phases)
7. Records usage per-vendor via a `CostProvider` so cost
   tracking, estimation, and cost-optimal routing (§ 68) stay
   out of the agent core
8. Reports completion status
9. Never does anything user didn't authorize

v1 ships with `ClaudeCodeAgent` as the only concrete agent, but
§ 27.5 (Provider Registry) makes adding the rest a pure
plugin-install step — no recompile of Desktop Agent core.

## Tech stack decision

**Node.js 20 LTS with TypeScript strict.**

Why Node.js:
- Matches backend (code sharing, shared types)
- Faster iteration than Rust/Go for MVP
- Plenty of OS integration libraries
- Easy installer creation (electron-builder reusable)
- Agent-aware community (most AI tooling is Node)

Downsides we accept:
- Heavier than Rust daemon (100MB+ installed)
- Slower startup than Go binary
- Memory footprint higher
- These are all fine for v1; optimize later if needed

## Packaging

### Windows (primary MVP target)
- Packaged as Windows Service via node-windows
- Installer: NSIS script creating .exe
- Size: ~80MB installed
- Auto-start on boot
- Runs in user session (not SYSTEM) — important for Claude Code to have user env

### macOS (Week 4+)
- Packaged as LaunchAgent
- Installer: .pkg file, signed with Apple Developer ID
- Notarized for Gatekeeper
- Size: ~80MB

### Linux (Week 5+)
- Packaged as systemd user service
- .deb and .rpm packages
- Size: ~80MB

## Directory structure

~/.operator-os/
  config.json        # configuration
  device.id          # UUID of this PC
  logs/              # local log files
    agent-2026-04-22.log
    commands/
      cmd-uuid.log   # per-command logs
  state/             # local state
    commands.db      # SQLite: command history, pending
  cache/             # cache
  tmp/               # scratch space for agents

Secret (in OS keychain, not filesystem):
- operator-os/device-token (the JWT for this device)
- operator-os/encryption-key (for local SQLite encryption)

## Core architecture

```
┌────────────────────────────────────────┐
│   Desktop Agent Process                │
│                                        │
│  ┌────────────────────────────────┐    │
│  │  WebSocket Client              │    │
│  │  - Connect to streamer         │    │
│  │  - Auto-reconnect              │    │
│  │  - Send heartbeat              │    │
│  │  - Receive commands            │    │
│  └────────┬───────────────────────┘    │
│           │                            │
│           ▼                            │
│  ┌────────────────────────────────┐    │
│  │  Command Dispatcher            │    │
│  │  - Validate signature          │    │
│  │  - Check permissions           │    │
│  │  - Route to executor           │    │
│  └────────┬───────────────────────┘    │
│           │                            │
│           ▼                            │
│  ┌────────────────────────────────┐    │
│  │  AIAgent Provider Registry     │    │
│  │  (§ 27.5)                      │    │
│  │  - ClaudeCodeAgent (v1)        │    │
│  │  - CodexAgent (Phase 2)        │    │
│  │  - CursorCLIAgent (Phase 2)    │    │
│  │  - OllamaAgent, ... (plugins)  │    │
│  │                                │    │
│  │  Non-agent executors           │    │
│  │  - git executor                │    │
│  │  - gh executor                 │    │
│  │  - npm/pnpm executor           │    │
│  │  - shell executor (restricted) │    │
│  └────────┬───────────────────────┘    │
│           │                            │
│           ▼                            │
│  ┌────────────────────────────────┐    │
│  │  StreamProvider                │    │
│  │  (§ 61 interface)              │    │
│  │  - Chunk output                │    │
│  │  - Send via WebSocket          │    │
│  │  - Buffer if disconnected      │    │
│  └────────────────────────────────┘    │
│                                        │
│  ┌────────────────────────────────┐    │
│  │  Local HTTP API (localhost)    │    │
│  │  - Status endpoint             │    │
│  │  - Emergency kill switch       │    │
│  │  - Config management           │    │
│  │  Accessible only from 127.0.0.1│    │
│  └────────────────────────────────┘    │
│                                        │
│  ┌────────────────────────────────┐    │
│  │  System Tray Icon (optional)   │    │
│  │  - Status indicator            │    │
│  │  - Quick actions               │    │
│  │  - Open web console            │    │
│  └────────────────────────────────┘    │
└────────────────────────────────────────┘
```

## Command execution protocol

### Command types in v1

1. **ai-agent-task**: Run an `AIAgent` with an instruction. The
   router (§ 61) selects the concrete agent by id or by
   capability; the dispatcher calls `agent.stream(task)` only.
   v1 ships with `ClaudeCodeAgent` as the only installed agent.
2. **git**: Run specific git operations (allowlisted commands)
3. **gh**: Run gh CLI operations (allowlisted)
4. **npm/pnpm**: Package manager operations (allowlisted)
5. **shell**: Restricted shell command (allowlist required)

### Allowlist approach for v1

Only commands explicitly approved by user in settings:
- Default allowlist: `ai-agent-task` (any installed agent), git,
  gh, pnpm, npm
- User can add more in settings
- Each command type has its own executor with specific handling
- Installing a new agent plugin (§ 27.5) does not widen the
  command-type allowlist; it only expands which agents
  `ai-agent-task` may dispatch to

### Why not arbitrary shell

Security. If we allow arbitrary shell, malicious backend could take over PC.
Even though we trust our backend, defense in depth.
Ability to run any shell is Enterprise-only or explicit user consent per-command.

### Reference implementation: ClaudeCodeAgent (implements AIAgent)

```typescript
import type { AIAgent, Task, OutputChunk, AgentResult, AgentStatus, ResourceMetrics, AgentConfig } from "@operator-os/contracts";

export class ClaudeCodeAgent implements AIAgent {
  readonly id = "anthropic.claude-code";
  readonly vendor = "anthropic" as const;
  readonly capabilities = [
    "code-generation",
    "code-editing",
    "multi-file-edit",
    "tool-use",
    "long-context",
    "thinking",
    "streaming",
    "cancel",
  ] as const satisfies ReadonlyArray<Capability>;

  private cwd!: string;
  private claudePath!: string;
  private active = new Map<string, IPty>();
  private state: AgentStatus["state"] = "idle";

  async initialize(config: AgentConfig): Promise<void> {
    this.state = "initializing";
    this.cwd = config.workingDirectory ?? process.cwd();
    this.claudePath = await this.locateClaudeCode();
    this.state = "ready";
  }

  async shutdown(): Promise<void> {
    this.state = "shutting-down";
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
    this.state = "idle";
  }

  async *stream(task: Task): AsyncIterable<OutputChunk> {
    const pty = nodePty.spawn(
      this.claudePath,
      [
        "--prompt", task.instruction,
        "--non-interactive",
        ...((task.flags?.args as string[] | undefined) ?? []),
      ],
      { cwd: this.cwd, env: process.env, cols: 120, rows: 40 },
    );
    this.active.set(task.id, pty);

    const queue: OutputChunk[] = [];
    let done = false;
    let exitCode = 0;

    pty.onData((data) => {
      queue.push({ taskId: task.id, stream: "stdout", data, at: new Date().toISOString() });
    });
    pty.onExit(({ exitCode: code }) => {
      exitCode = code;
      done = true;
    });

    while (!done || queue.length) {
      if (queue.length) yield queue.shift()!;
      else await new Promise((r) => setTimeout(r, 25));
    }
    this.active.delete(task.id);
    if (exitCode !== 0) {
      yield { taskId: task.id, stream: "meta", data: `exit=${exitCode}`, at: new Date().toISOString() };
    }
  }

  async execute(task: Task): Promise<AgentResult> {
    let finalOutput = "";
    for await (const chunk of this.stream(task)) {
      if (chunk.stream === "stdout") finalOutput += chunk.data;
    }
    return {
      taskId: task.id,
      exitCode: 0,
      finalOutput,
      usage: await this.reportUsage(task),
    };
  }

  async cancel(taskId: string): Promise<void> {
    const pty = this.active.get(taskId);
    if (!pty) return;
    pty.kill("SIGINT");
    setTimeout(() => {
      if (this.active.has(taskId)) pty.kill("SIGKILL");
    }, 5000);
  }

  status(): AgentStatus { return { state: this.state, runningTasks: this.active.size }; }
  resourceUsage(): ResourceMetrics {
    return {
      cpuPercent: 0,         // populated by ResourceMonitor (§ 37)
      memoryMB: 0,
      openFileHandles: 0,
      activeSubprocesses: this.active.size,
    };
  }

  private async locateClaudeCode(): Promise<string> { /* platform-specific */ return "claude"; }
  private async reportUsage(task: Task): Promise<UsageEvent> { /* reads Claude Code session usage */ return null as never; }
}
```

Key points about this reference implementation:

- Implements `AIAgent` from `@operator-os/contracts`. No part of
  Desktop Agent core imports `ClaudeCodeAgent` directly — it is
  loaded by the provider registry (§ 27.5) and handed back
  through the interface.
- Quota, subprocess management, streaming, cancellation, and
  resource reporting live inside the agent. Callers see only the
  interface methods.
- `capabilities` is declared once; callers that need "does this
  agent support vision" read `agent.capabilities.includes("vision")`,
  never `agent.vendor === "anthropic"`.
- The same shape is followed by `CodexAgent`, `CursorCLIAgent`,
  `OllamaAgent`, etc. — see § 62-66.7.

## § 27.5 Provider Registry

The Desktop Agent owns a **provider registry**: a runtime record
of which `AIAgent` implementations are installed, which is
currently enabled, and what each one advertises as its
capabilities, pricing, and file-system / stream requirements.

### Installation model

Concrete agents are plugins. The user installs them individually:

```
operator-agent install claude-code           # pre-installed in v1
operator-agent install codex                 # Phase 2
operator-agent install cursor                # Phase 2
operator-agent install chatgpt-desktop       # Phase 2
operator-agent install gemini                # Phase 2
operator-agent install ollama                # Phase 2
operator-agent install lm-studio             # Phase 2
operator-agent install copilot-workspace     # Phase 3
operator-agent install <custom-npm-package>  # open standard
```

Each plugin is distributed as one of:

- A scoped npm package under `@operator-os-agents/*` (most
  agents).
- A signed binary in a known release channel (for agents whose
  native surface does not map well to Node, e.g. Ollama).

Installation is a three-step dance:

1. The CLI resolves the plugin to a tarball or binary and
   verifies its publisher signature (required; the registry
   refuses unsigned plugins outside developer mode).
2. The tarball is unpacked into
   `~/.operator-os/providers/<plugin-id>/` with read-only perms.
3. The plugin's manifest is merged into
   `~/.operator-os/providers/registry.json`, which the running
   Desktop Agent process re-reads on SIGHUP.

### Provider manifest

Every plugin ships a `provider.manifest.json`:

```json
{
  "id": "anthropic.claude-code",
  "vendor": "anthropic",
  "displayName": "Claude Code",
  "version": "1.0.0",
  "entry": "./dist/index.js",
  "capabilities": [
    "code-generation", "code-editing", "multi-file-edit",
    "tool-use", "long-context", "thinking", "streaming", "cancel"
  ],
  "requires": {
    "binary": "claude",
    "minVersion": "1.0.0",
    "filesystem": ["local"],
    "stream": ["memory", "websocket"]
  },
  "pricing": "@operator-os-agents/claude-code/pricing",
  "permissions": {
    "network": ["api.anthropic.com"],
    "filesystem": ["$WORKSPACE"],
    "spawnBinaries": ["claude"]
  },
  "signature": "<base64 ed25519 sig over the manifest>"
}
```

Fields beyond `id` / `version` / `entry`:

- `capabilities` must match what the agent's `capabilities` field
  advertises at runtime; the registry rejects plugins whose
  runtime capabilities diverge from their manifest.
- `requires` gates loading: if the declared binary is missing, or
  the installed FileSystemProvider / StreamProvider types are not
  among `requires.filesystem` / `requires.stream`, the registry
  marks the provider as "installed, not available" and surfaces
  that to the mobile app.
- `permissions` defines the sandboxing rules — the plugin can
  spawn only the listed binaries, write only under the declared
  filesystem roots, and connect out only to the declared hosts.
  Enforced via the local executor (§ 30) and a firewall hook
  where the OS exposes one.

### Lifecycle

```
installed -> validated -> available -> enabled -> busy
     |            |            |           |         |
     v            v            v           v         v
  rejected   unavailable   disabled   disabled   crashed
```

- **installed**: tarball on disk, manifest parsed.
- **validated**: signature ok, manifest schema ok, binary present.
- **available**: `initialize()` returned without error;
  `status().state === "ready"`.
- **enabled**: user has the provider turned on in settings.
- **busy**: at least one task running.
- **disabled** / **unavailable**: user turned off, or a
  `requires` check failed.
- **crashed**: three consecutive task failures attributed to the
  agent itself; the registry auto-disables and surfaces an alert.

The registry exposes the current lifecycle state via the local
HTTP API (§ 27 architecture) so the mobile app can show
"Claude Code: available", "Codex: disabled", "Ollama: not
installed" without the backend polling the desktop.

### Dispatch

When the backend dispatches an `ai-agent-task`:

1. If the task specifies `agentId`, the registry looks it up and
   rejects the task if not in `available` + `enabled`.
2. If the task specifies only `requiredCapabilities`, the router
   (§ 61) picks the cheapest enabled agent whose capabilities
   cover the requirement. Pricing comes from the agent's
   `CostProvider`.
3. The registry returns a live `AIAgent` handle; the dispatcher
   calls `stream(task)` and forwards chunks through the
   configured `StreamProvider`.

### Developer-mode override

For local development, `OPERATOR_AGENT_DEVMODE=1` disables
signature verification and allows loading a plugin from a local
path. The mobile app shows a persistent warning banner while any
dev-mode provider is loaded, because these plugins bypass the
security checks listed above. LAW #4 (Security-First).

## Heartbeat protocol

Every 30 seconds, desktop agent sends:
  {
    "type": "heartbeat",
    "deviceId": "...",
    "timestamp": "...",
    "uptime": 12345,
    "runningCommands": N,
    "resources": {
      "cpuPercent": 42.5,
      "memoryMB": 512,
      "diskFreeGB": 250
    },
    "version": "1.0.0"
  }

Backend responds with:
  {
    "type": "heartbeat.ack",
    "pendingCommands": [ ... ]
  }

If no heartbeat for 90 seconds → backend marks device offline.
If backend does not respond to heartbeat → agent marks itself disconnected,
queues outgoing messages, retries connection.

## Reconnection logic

```
connect() {
  attempt = 0;
  while (true) {
    try {
      await wsConnect();
      attempt = 0;
      break;
    } catch (e) {
      attempt++;
      const backoff = Math.min(60, Math.pow(2, attempt));
      await sleep(backoff * 1000);
    }
  }
}
```

On reconnect:
1. Send catchup request with last-seen event ID
2. Backend sends any missed commands
3. Resume normal operation

## System tray integration (optional but included)

Minimal tray menu:
- 🟢 Connected / 🔴 Disconnected (status icon)
- "Open Dashboard" (opens browser to https://app.operator-os.com)
- "Kill all tasks" (emergency stop)
- "Settings" (opens native settings window)
- "Quit"

Implementation: separate small Electron shell communicating with
main agent via localhost HTTP API.

## Installation UX

### Windows installer flow

1. User downloads OperatorOS-Setup.exe
2. Double-clicks
3. UAC prompt: "Install Operator-OS?" — user clicks Yes
4. Installer window appears:
   - Welcome screen with logo
   - License agreement
   - Install location (default: %ProgramFiles%\OperatorOS)
   - Progress bar
5. Post-install screen:
   - "Operator-OS is installed!"
   - "Enter the pairing code from your phone:"
   - Input field: [ABCD-1234]
   - [Connect] button
6. User opens mobile app, taps "Pair new PC"
7. Mobile shows pairing code
8. User types on PC
9. Clicks Connect
10. "✅ Connected! This PC is now linked to your account."
11. Agent starts as Windows Service

Total time: < 2 minutes.

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK V — MOBILE APPLICATION
═══════════════════════════════════════════════════════════════════════════════

§ 38. MOBILE APP ARCHITECTURE

## Stack decision: React Native + Expo

Why not native:
- 2 platforms to maintain (iOS Swift + Android Kotlin) = 2x work
- We are solo founder, can't afford that
- React Native performance is good enough for our UI (not a 3D game)

Why Expo:
- Managed workflow simplifies 80% of cases
- EAS Build for easy CI/CD
- OTA updates without app store for certain changes
- Push notifications infrastructure included
- Secure Store, Notifications, Speech included

Why React Native 0.75+:
- New architecture (Fabric, TurboModules) production-ready
- Performance significantly better than 0.70
- Better Hermes engine

## State management: Zustand + TanStack Query

Zustand for client state:
- Auth state
- UI state (which modal open, etc.)
- Device-local preferences

TanStack Query for server state:
- Task lists
- PR lists
- Usage data
- Automatic refetch, caching, optimistic updates

Not Redux Toolkit:
- Overkill for solo-built app
- Zustand simpler, smaller, faster

## Navigation: React Navigation v7

Pattern: Tab navigator root with stack navigators per tab.
Tabs:
- Home (default)
- Tasks
- Code (GitHub/PRs)
- Cost
- Settings

## File structure

```
apps/mobile/
  app/
    _layout.tsx           # root layout
    (auth)/               # auth flow (grouped)
      signin.tsx
      pair-device.tsx
    (main)/               # main app (grouped)
      _layout.tsx         # tab layout
      home/
        index.tsx
        task-composer.tsx
      tasks/
        index.tsx
        [taskId].tsx      # task detail
        [taskId]/terminal.tsx  # live terminal
      code/
        index.tsx
        prs.tsx
        [prId].tsx
      cost/
        index.tsx
        analysis.tsx
      settings/
        index.tsx
        ...
  components/
    ui/                   # base UI (Button, Card, etc.)
    tasks/                # task-specific components
    terminal/             # terminal emulator components
    diff-viewer/          # PR diff viewer
  lib/
    api.ts                # API client
    auth.ts               # auth logic
    websocket.ts          # WS client
    storage.ts            # MMKV wrapper
  hooks/
    use-auth.ts
    use-tasks.ts
    use-websocket.ts
  types/
    ...
```

═══════════════════════════════════════════════════════════════════════════════

§ 40. DESIGN SYSTEM

## Color palette

### Light mode (default)
- Background primary: #FFFFFF
- Background secondary: #F7F7F8
- Background tertiary: #EEEEEF
- Text primary: #0A0A0A
- Text secondary: #4A4A4A
- Text tertiary: #9A9A9A
- Accent: #0066FF (blue — calm, trustworthy)
- Success: #00A86B (emerald green)
- Warning: #FF8800 (amber)
- Error: #E53E3E (red)
- Info: #3B82F6 (sky blue)
- Border: #E5E5E7

### Dark mode
- Background primary: #0A0A0A
- Background secondary: #1C1C1E
- Background tertiary: #2C2C2E
- Text primary: #FFFFFF
- Text secondary: #B0B0B0
- Text tertiary: #6A6A6A
- Accent: #4D9FFF (lighter blue for dark)
- Success: #34D399
- Warning: #FBBF24
- Error: #F87171
- Info: #60A5FA
- Border: #3A3A3C

### Agent status colors
- Online & idle: #00A86B
- Running task: #0066FF (with pulse animation)
- Disconnected: #9A9A9A
- Error state: #E53E3E

## Typography

Font family: SF Pro (iOS), Inter (Android, as close to SF Pro as possible).

Scale:
- Display: 32px / 40 line-height / Bold
- H1: 28px / 36 / Bold
- H2: 22px / 30 / Semibold
- H3: 18px / 26 / Semibold
- Body: 16px / 24 / Regular
- Callout: 16px / 22 / Semibold
- Subhead: 14px / 20 / Regular
- Footnote: 13px / 18 / Regular
- Caption: 11px / 16 / Regular
- Mono: 14px (for code/terminal)

## Spacing

8px grid system:
- xs: 4
- sm: 8
- md: 16
- lg: 24
- xl: 32
- 2xl: 48
- 3xl: 64

## Corner radius

- Small: 8 (buttons, chips)
- Medium: 12 (cards)
- Large: 16 (sheets, modals)
- XL: 24 (feature cards)
- Full: 9999 (pill buttons)

## Shadows (light mode)

- Level 1 (subtle): 0 1px 2px rgba(0,0,0,0.04)
- Level 2 (cards): 0 2px 8px rgba(0,0,0,0.08)
- Level 3 (modals): 0 8px 24px rgba(0,0,0,0.12)
- Level 4 (dropdowns): 0 16px 40px rgba(0,0,0,0.16)

Dark mode shadows: glowing borders instead (no shadows in dark).

## Component library (primitives)

### Button
Variants:
- Primary (accent color, high emphasis)
- Secondary (outlined, medium emphasis)
- Tertiary (text only, low emphasis)
- Destructive (red, for dangerous actions)
- Ghost (transparent, for overlays)

Sizes:
- Small (height 32)
- Medium (height 44) — default
- Large (height 56) — for primary CTAs

Props: loading state, icon (left/right), disabled state.

### Card
Variants:
- Default (background secondary)
- Elevated (with shadow)
- Outlined (with border)
- Interactive (with hover/press states)

### Input
Variants:
- Text
- Textarea
- Search
- Password

With clear button, icon slots, error state, helper text.

### Badge
For status indicators. Small, rounded pill.
Variants: default, success, warning, error, info.

### Avatar
User photo or initials. Sizes: xs, sm, md, lg, xl.

### List
Stacked list of items with consistent styling.
Row types: simple, with icon, with meta, swipeable.

### Sheet
Bottom sheet that slides up from bottom.
For quick actions, forms, confirmations.

### Toast
Ephemeral notification at top.
Types: success, error, info, warning.

### Modal
Full-screen modal for complex interactions.

### Skeleton
Shimmer loading states. Match card/content shape.

═══════════════════════════════════════════════════════════════════════════════

§ 44. HOME SCREEN (detailed mockup in words)

The home screen is the founder's command center. Every element matters.

## Visual layout (iPhone 15 Pro, 393pt wide)

```
┌─────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░ (status bar)           │
├─────────────────────────────────────────┤
│                                         │
│  Good morning, Akmal              🔔 3  │
│  Tashkent · 9:42 AM                     │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │                                   │  │
│  │  🟢  Home PC                      │  │
│  │      Connected · 3h 42m uptime    │  │
│  │                                   │  │
│  │   Agents:                         │  │
│  │   • Claude Code #1  ⚡ running    │  │
│  │     Fix auth bug... (2m 15s)      │  │
│  │   • Claude Code #2  💤 idle       │  │
│  │   • + Launch new agent            │  │
│  │                                   │  │
│  │  [📊 Details]  [⏸ Pause all]      │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  🔴  Laptop                       │  │
│  │      Offline · last seen 4h ago   │  │
│  │      [Wake] [Settings]            │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [+ Connect new PC]                     │
│                                         │
│  ─── Quick Actions ────────────────     │
│                                         │
│  [+ New Task]  [🎤 Voice Task]          │
│                                         │
│  [🔍 Recent PRs (3)]  [💰 Cost today]   │
│                                         │
│  ─── Live Activity ───────────────      │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ ⚡ Home PC · Claude Code #1      │   │
│  │ Fix auth bug in mobile tests     │   │
│  │                                  │   │
│  │ > Running tests...               │   │
│  │ > ✓ Tests pass (3/3)             │   │
│  │ > Committing...                  │   │
│  │                                  │   │
│  │ [📺 Watch live]  [⏹ Stop]        │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ ✅ Home PC · Claude Code #2       │   │
│  │ Add rate limiting to API         │   │
│  │ Completed 1h ago · 47k tokens    │   │
│  │ [📄 View PR #52]                 │   │
│  └──────────────────────────────────┘   │
│                                         │
│  [ See all tasks → ]                    │
│                                         │
├─────────────────────────────────────────┤
│  🏠    ✅    💻    💰    ⚙️             │
│  Home  Tasks Code Cost Settings         │
└─────────────────────────────────────────┘
```

## Interactions

### Header
- 🔔 badge shows unread notification count (max "99+")
- Tap 🔔 → opens notification center (slide-in from right)
- Long-press on greeting → shows detailed timezone/location info

### PC cards
- Tap card (not buttons) → expand/collapse agent list
- Tap agent row → go to agent detail
- "Pause all" → shows confirmation bottom sheet
- Long-press PC card → quick actions menu (rename, remove, etc.)

### Quick Actions
- "+ New Task" (primary, largest button) → opens Task Composer
- "🎤 Voice Task" → opens voice composer directly (skips text)
- Other buttons → navigate to respective sections

### Live Activity cards
- Updates in real-time via WebSocket
- "📺 Watch live" → opens Live Terminal view
- "⏹ Stop" → confirmation sheet, then cancel task
- Completed tasks auto-collapse after 10 seconds but remain visible

### Pull to refresh
- Refreshes PC status, active tasks, cost data
- Shimmer animation on fresh data loading
- Error toast if network fails

## Empty states

### No PCs connected
Instead of PC cards:
```
  ┌───────────────────────────────────┐
  │                                   │
  │      💻                           │
  │                                   │
  │    No PCs connected yet           │
  │                                   │
  │    Download the Operator          │
  │    Desktop Agent on your PC       │
  │    and pair it here.              │
  │                                   │
  │  [📥 Download for Windows]        │
  │  [📥 Download for macOS]          │
  │  [📥 Download for Linux]          │
  │                                   │
  │  [🔗 Or scan QR code to pair]     │
  │                                   │
  └───────────────────────────────────┘
```

### No tasks yet
Below quick actions:
```
  ┌───────────────────────────────────┐
  │      🎯                           │
  │    Ready to delegate?             │
  │                                   │
  │    Tap "New Task" to launch       │
  │    your first agent command.      │
  │                                   │
  │    💡 Example tasks:              │
  │    • Fix a failing test           │
  │    • Refactor a module            │
  │    • Deploy to production         │
  │    • Run code review              │
  │                                   │
  └───────────────────────────────────┘
```

═══════════════════════════════════════════════════════════════════════════════

§ 46. LIVE TERMINAL VIEW (killer screen)

This is the screen that makes users say "holy shit."

## Layout

```
┌─────────────────────────────────────────┐
│  ← Back         Home PC · CC#1     ⋮    │
│                                         │
│  Fix auth bug in mobile tests           │
│  Started 2m 34s ago · 12,384 tokens     │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ akmal@home-pc D:\Operator-OS-Dev  │  │
│  │                                   │  │
│  │ $ claude --prompt "fix auth..."   │  │
│  │                                   │  │
│  │ Reading mobile auth tests...      │  │
│  │ Found error in auth.test.ts:47    │  │
│  │                                   │  │
│  │   Type "Promise<string>" is not   │  │
│  │   assignable to type "string"     │  │
│  │                                   │  │
│  │ Analyzing fix options...          │  │
│  │                                   │  │
│  │ Applying fix:                     │  │
│  │ - const result = auth();          │  │
│  │ + const result = await auth();    │  │
│  │                                   │  │
│  │ Running tests...                  │  │
│  │ ✓ auth.test.ts (3 passed)         │  │
│  │ ✓ All tests pass                  │  │
│  │                                   │  │
│  │ ▌                                 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [⏹ Stop]  [💾 Save log]  [🔍 Search]   │
│                                         │
└─────────────────────────────────────────┘
```

## Technical implementation

### Rendering terminal
- xterm.js? No, too heavy for mobile.
- Custom React Native component that renders text chunks
- Supports ANSI color codes (convert to styled text)
- Monospace font (SF Mono / JetBrains Mono)
- Auto-scroll to bottom (with option to disable when user scrolls up)

### Streaming performance
- Receive chunks via WebSocket (from backend streamer)
- Buffer chunks in a FlatList (windowed rendering)
- Cap at last 10,000 lines in memory (older archived to disk)
- 60fps scrolling even with rapid output

### Interactive features
- Tap on line with file path → open in Code tab
- Long-press on error → suggest fix (launch new agent task)
- Tap on URL → open in browser
- Select text → copy (system-standard selection)

### Stop button
- Tap → confirmation sheet:
  "Stop this task? Progress will be saved, but work in progress is lost."
  [Stop] [Cancel]
- On stop → sends cancel command, shows "Cancelling..." state
- Task transitions to "cancelled" status

═══════════════════════════════════════════════════════════════════════════════

§ 47. TASK COMPOSER (the magic moment)

## Layout

```
┌─────────────────────────────────────────┐
│  ╳                      New Task        │
│                                         │
│  Target PC                              │
│  ┌───────────────────────────────────┐  │
│  │  🟢 Home PC                     ▾ │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Agent slot                             │
│  ┌───────────────────────────────────┐  │
│  │  ⚡ Claude Code #2 (idle)       ▾ │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Task description                       │
│  ┌───────────────────────────────────┐  │
│  │                                   │  │
│  │  Describe what you want           │  │
│  │  the agent to do...               │  │
│  │                                   │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [🎤 Dictate]  [📋 Template]  [💡 Sugg] │
│                                         │
│  ─── Advanced ────────────────          │
│                                         │
│  Working directory                      │
│  ┌───────────────────────────────────┐  │
│  │ D:\Operator-OS-Dev              📁│  │
│  └───────────────────────────────────┘  │
│                                         │
│  Priority                               │
│  ( ) Low   (•) Normal   ( ) High        │
│                                         │
│  Timeout                                │
│  ┌──────┐  (min)                        │
│  │  30  │                                │
│  └──────┘                                │
│                                         │
│  Token budget                           │
│  ┌──────┐                                │
│  │ 50000│                                │
│  └──────┘                                │
│                                         │
│  Estimated cost: $0.85                  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [ Send to agent ]                      │
│                                         │
└─────────────────────────────────────────┘
```

## Voice input flow

1. User taps 🎤
2. Sheet slides up:
   ```
   ┌───────────────────────────────┐
   │                               │
   │           🎤                  │
   │                               │
   │    Listening...               │
   │                               │
   │    ▓▓▓▓▓░░░░░░                │
   │                               │
   │   [Stop]                      │
   │                               │
   └───────────────────────────────┘
   ```
3. Real-time transcription shown below wave
4. Tap Stop → transcript appears in text area
5. User can edit before sending

## Template picker

Templates per common use case:
- Fix failing test
- Code review a PR
- Deploy to production
- Refactor module
- Write tests for file
- Generate documentation
- Investigate bug
- Research topic (for research tasks)

Tap template → fills text area with placeholders user edits.

## Smart suggestions

Based on:
- Recent commits on this repo
- Recent errors in CI
- Open issues/PRs
- Time of day (morning = planning, evening = review)

Examples shown in real-time:
💡 "CI failed on main 10 min ago — investigate?"
💡 "3 open PRs pending review"
💡 "You have a stale branch feat/old-feature"

═══════════════════════════════════════════════════════════════════════════════

§ 49. PULL REQUEST REVIEW SCREEN

## Layout

```
┌─────────────────────────────────────────┐
│  ← PRs         #47 Fix auth bug    ⋮    │
│                                         │
│  fix(mobile): correct type signature    │
│  by Akmal · 2m ago                      │
│                                         │
│  [✓ Ready] [🔴 1 check failed] [🟢 CI]  │
│                                         │
│  Files changed (1)                      │
│  ─────────────────────────────────      │
│                                         │
│  📄 apps/mobile/auth.test.ts            │
│  +1 -1                                  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ 45    describe("auth()", () => {  │  │
│  │ 46      it("returns token", async │  │
│  │ 47  ─   const result = auth();    │  │
│  │ 47  +   const result = await auth │  │
│  │ 48      expect(result).toBeDef... │  │
│  │ 49      })                        │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [💬 Comment on line]                   │
│                                         │
│  ─── Description ──────────            │
│                                         │
│  Fixes type error in auth test caused   │
│  by missing await. All 3 auth tests     │
│  now pass.                              │
│                                         │
│  ─── Reviews ───────────────           │
│                                         │
│  No reviews yet.                        │
│                                         │
│  ─── Checks ────────────────           │
│                                         │
│  ✓ CI / test (passed 1m ago)            │
│  ✓ CI / lint (passed 1m ago)            │
│  ✓ CI / typecheck (passed 30s ago)      │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [ Approve ]  [ Request changes ]       │
│                                         │
│  [ Merge ▾ ]                            │
│                                         │
└─────────────────────────────────────────┘
```

## Diff viewer details

### Rendering approach
- Parse diff from GitHub API
- Unified diff view (not side-by-side on narrow phone)
- Switchable: tap view mode icon → split view on tablet/landscape
- Syntax highlighting via tree-sitter (WASM in React Native)
- Line numbers always visible
- Changed lines highlighted (green/red background)

### Navigation
- Swipe left/right → next/previous file (if multi-file PR)
- Scroll up/down normally
- Jump to hunk: tap hunk header

### Commenting
- Tap line number → selection toolbar appears
- Tap "Comment" → keyboard opens
- Write comment → submit
- Threads expand inline

## Merge menu

Tap [ Merge ▾ ] → bottom sheet:
```
  How would you like to merge?

  ( ) Create a merge commit
      Preserves history, 1 commit added

  (•) Squash and merge         ← default
      Single clean commit on main

  ( ) Rebase and merge
      Replays commits on main

  ☑ Delete branch after merge

  [ Confirm merge ]
```

After merge:
- Success toast
- Screen updates to "Merged" state
- CI check status for main branch shown

═══════════════════════════════════════════════════════════════════════════════

§ 51. COST DASHBOARD SCREEN

## Layout

```
┌─────────────────────────────────────────┐
│  Cost                    Pro · $29/mo   │
│                                         │
│  Today                                  │
│  ┌───────────────────────────────────┐  │
│  │                                   │  │
│  │  $3.47                            │  │
│  │  spent today                      │  │
│  │                                   │  │
│  │  84,320 tokens · 12 tasks         │  │
│  │                                   │  │
│  │  ↑ 23% vs yesterday               │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  This month                             │
│  ┌───────────────────────────────────┐  │
│  │  $42.18 / $100 budget (42%)       │  │
│  │  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░         │  │
│  │  20 days left                     │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ─── Breakdown ─────────────           │
│                                         │
│  By provider (this month)               │
│  ├─ 🟣 Claude (Anthropic)  $31.50 75%   │
│  ├─ 🟢 OpenAI GPT           $7.80 18%   │
│  └─ 🔵 Gemini               $2.88  7%   │
│                                         │
│  By PC                                  │
│  ├─ 💻 Home PC             $35.20 83%   │
│  └─ 💼 Laptop               $6.98 17%   │
│                                         │
│  By agent                               │
│  ├─ Claude Code #1          $22.10      │
│  ├─ Claude Code #2          $13.10      │
│  └─ Codex #1                 $6.98      │
│                                         │
│  ─── Insights ──────────────           │
│                                         │
│  💡 You could have saved $8.40          │
│     6 tasks would've worked fine with   │
│     Claude Haiku instead of Opus.       │
│     [ Review suggestions → ]            │
│                                         │
│  💡 Budget alert                        │
│     At current pace you'll hit $85      │
│     by end of month.                    │
│                                         │
│  ─── Trend ─────────────────           │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │        ▁▂▃▄▅▆▇█▇▆▇▆               │  │
│  │  30 days ago              today   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [ View full analysis → ]               │
│                                         │
└─────────────────────────────────────────┘
```

## Real-time updates

Cost updates as tasks run:
- Current day counter ticks up
- Budget progress animates
- Live badge when task consuming tokens

## Savings analysis (killer feature)

Algorithm:
1. For each completed task, analyze:
   - Prompt complexity (simple classification)
   - Context size
   - Output length
2. Estimate what cheaper model would've produced
3. Simulate (by re-running through lighter model occasionally)
4. Report difference as "savings opportunity"
5. Over time, learn user's quality threshold

Not just cost-cutting: respects user's preference for quality.

═══════════════════════════════════════════════════════════════════════════════

§ 53. AGENT COORDINATION SCREEN

## The multi-agent orchestration interface

```
┌─────────────────────────────────────────┐
│  ← Home         Agent Swarm        ⋮    │
│                                         │
│  Active: 3    Idle: 2    Total: 5       │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Home PC                          │  │
│  │  ┌──────────┐  ┌──────────┐       │  │
│  │  │  CC #1   │  │  CC #2   │       │  │
│  │  │  ⚡active │  │  💤idle   │       │  │
│  │  │          │  │          │       │  │
│  │  │ Auth fix │  │          │       │  │
│  │  │ 2m 30s   │  │          │       │  │
│  │  └──────────┘  └──────────┘       │  │
│  │  ┌──────────┐  ┌──────────┐       │  │
│  │  │ Codex #1 │  │  + add   │       │  │
│  │  │ ⚡active  │  │          │       │  │
│  │  │          │  │          │       │  │
│  │  │ Tests    │  │          │       │  │
│  │  │ 5m 12s   │  │          │       │  │
│  │  └──────────┘  └──────────┘       │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  Laptop (offline)                 │  │
│  │  2 agents idle                    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ─── Coordination ─────────            │
│                                         │
│  [⚡ Launch new agent]                  │
│  [📋 Distribute task to multiple]       │
│  [🔄 Hand off task]                     │
│                                         │
│  ─── Queue ─────────────────           │
│                                         │
│  Waiting for agent (2)                  │
│  • "Deploy staging" (high priority)     │
│  • "Review PR #52"                      │
│                                         │
│  [ Manage queue → ]                     │
│                                         │
└─────────────────────────────────────────┘
```

## Multi-agent commands

### Distribute task
User describes task.
Backend conductor:
1. Breaks task into subtasks
2. Assigns to available agents
3. Coordinates handoffs
4. Merges results

Example: "Review all 3 open PRs, summarize findings."
→ Agent 1: PR #47 → summary
→ Agent 2: PR #48 → summary
→ Agent 3: PR #49 → summary
→ Conductor: merge summaries into one report
→ User sees single result

### Hand off task
User tags an active task as stuck.
User selects "Hand off".
Current agent produces context dump.
New agent (maybe different model) picks up with full context.

═══════════════════════════════════════════════════════════════════════════════

§ 56. PUSH NOTIFICATIONS STRATEGY

## Principle: respect user's attention

Bad: notify on every output chunk (spam)
Good: notify on meaningful state changes

## What triggers push

### High priority (always notify, even in DND)
- System critical errors (device compromised, budget exceeded)
- Manually triggered notifications (user asked)

### Medium priority (notify unless DND)
- Task complete
- Task failed
- PR needs review (for tasks user started)
- Device went offline
- Budget threshold reached

### Low priority (batched daily)
- Daily summary
- Cost report
- Insights

### No notification
- Task started (user knows, they started it)
- Subprocess output chunks
- Heartbeats

## Notification content

Always includes:
- Clear action verb: "Complete", "Failed", "Ready"
- Context: PC name, task description
- Actionability: tap → goes directly to relevant screen

Example:
"✅ Home PC: PR #47 opened — tap to review"

## Scheduling

- Respect user's quiet hours (23:00-07:00 default)
- User can customize per notification type
- Urgent always delivers (but silent if quiet hours)
- Smart bundling if multiple in 1 minute

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK VI — AI PROVIDER ABSTRACTION
═══════════════════════════════════════════════════════════════════════════════

§ 61. MULTI-AI ROUTER ARCHITECTURE

## The routing challenge

Different tasks benefit from different models:
- Simple Q&A: Haiku or Gemini Flash (cheap, fast)
- Complex reasoning: Opus or GPT-5 (expensive, best quality)
- Code generation: Claude Code or Codex (specialized)
- Image analysis: Gemini or GPT-4V
- Long context: Claude 200K or Gemini 1M
- Speed critical: fast model regardless
- Cost sensitive: cheapest viable

## Router design

```
┌─────────────────────────────────────────┐
│   AI Router Service                     │
│                                         │
│   Input: task request                   │
│     │                                   │
│     ▼                                   │
│   ┌─────────────────────────────┐       │
│   │  Task Classifier            │       │
│   │  (using lightweight model)  │       │
│   │  - Complexity level         │       │
│   │  - Required capabilities    │       │
│   │  - Estimated token range    │       │
│   └─────────────┬───────────────┘       │
│                 ▼                       │
│   ┌─────────────────────────────┐       │
│   │  Provider Selector          │       │
│   │  - Check user preferences   │       │
│   │  - Check quotas             │       │
│   │  - Check provider health    │       │
│   │  - Apply routing rules      │       │
│   └─────────────┬───────────────┘       │
│                 ▼                       │
│   ┌─────────────────────────────┐       │
│   │  Provider Invoker           │       │
│   │  - Translate to provider    │       │
│   │    specific format          │       │
│   │  - Add provider-specific    │       │
│   │    system prompts           │       │
│   │  - Invoke with retries      │       │
│   └─────────────┬───────────────┘       │
│                 ▼                       │
│   ┌─────────────────────────────┐       │
│   │  Response Normalizer        │       │
│   │  - Standard response format │       │
│   │  - Cost calculation         │       │
│   │  - Usage tracking           │       │
│   └─────────────────────────────┘       │
└─────────────────────────────────────────┘
```

## Core interfaces (TypeScript)

Per LAW #3 and the Universal AI Control Platform ADR (2026-04-23),
**four provider-agnostic interfaces** form the contract that every
agent-aware piece of the system must go through. Concrete agent
classes (e.g. `ClaudeCodeAgent`) are never imported directly from
Desktop Agent core, the backend command dispatcher, the mobile UI,
or the conductor. They are registered at runtime via the provider
registry (§ 27.5) and accessed only through these interfaces.

### AIAgent

Any AI coding or task agent — Claude Code CLI, Codex CLI, Cursor
CLI, ChatGPT desktop, Gemini CLI, Ollama, LM Studio, Copilot
Workspace, future tools. One implementation per concrete agent.

```typescript
type AIVendor =
  | "anthropic"
  | "openai"
  | "google"
  | "cursor"
  | "github"
  | "local"
  | "custom";

type Capability =
  | "code-generation"
  | "code-editing"
  | "chat"
  | "tool-use"
  | "vision"
  | "long-context"       // >= 200K tokens
  | "thinking"           // explicit reasoning mode
  | "sandbox"            // isolated code execution
  | "file-write"
  | "multi-file-edit"
  | "streaming"
  | "cancel"
  | "offline";           // no network required

interface AgentConfig {
  agentId: string;                  // stable registry id
  workingDirectory?: string;
  env?: Record<string, string>;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

interface Task {
  id: string;
  instruction: string;
  filesInScope?: string[];
  timeoutMs?: number;
  budgetUsd?: number;
  flags?: Record<string, unknown>;
}

interface AgentResult {
  taskId: string;
  exitCode: number;
  finalOutput: string;
  artifacts?: { path: string; sha256: string }[];
  usage: UsageEvent;
}

interface OutputChunk {
  taskId: string;
  stream: "stdout" | "stderr" | "meta";
  data: string | Uint8Array;
  at: string;              // ISO timestamp
}

interface AgentStatus {
  state: "idle" | "initializing" | "ready" | "busy" | "shutting-down" | "error";
  runningTasks: number;
  lastError?: { code: string; message: string; at: string };
}

interface ResourceMetrics {
  cpuPercent: number;
  memoryMB: number;
  openFileHandles: number;
  activeSubprocesses: number;
}

interface AIAgent {
  readonly id: string;
  readonly vendor: AIVendor;
  readonly capabilities: Capability[];

  // Lifecycle
  initialize(config: AgentConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Execution
  execute(task: Task): Promise<AgentResult>;
  stream(task: Task): AsyncIterable<OutputChunk>;
  cancel(taskId: string): Promise<void>;

  // State
  status(): AgentStatus;
  resourceUsage(): ResourceMetrics;
}
```

Notes:

- Agents are responsible for their own subprocess management,
  token counting, and vendor-API handshakes. Callers never see
  `node-pty`, `anthropic` SDK, or raw HTTP.
- Capability branching (e.g. "does this agent support vision?")
  reads `agent.capabilities`. Core code must not branch on
  `agent.vendor` — that is for logging only.
- `execute` is the non-streaming convenience over `stream`;
  implementations typically build `execute` on top of `stream`.

### FileSystemProvider

Abstracts over local FS, SSH remote, cloud workspace, and
sandboxed containers. Agents and the command dispatcher never call
`fs.readFile` directly.

```typescript
type FSProviderType = "local" | "ssh" | "cloud" | "sandbox" | "other";

interface FileInfo {
  path: string;
  kind: "file" | "dir" | "symlink";
  sizeBytes: number;
  modifiedAt: string;        // ISO timestamp
  mode?: number;             // POSIX mode bits, if applicable
}

interface FileChange {
  path: string;
  kind: "created" | "modified" | "deleted" | "renamed";
  to?: string;               // for rename
  at: string;
}

type FileChangeHandler = (change: FileChange) => void;
type Unsubscribe = () => void;

interface FileSystemProvider {
  readonly type: FSProviderType;
  readonly rootPath: string;

  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  list(path: string): Promise<FileInfo[]>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  watch(path: string, handler: FileChangeHandler): Unsubscribe;
}
```

Notes:

- Every path is provider-relative to `rootPath`. Absolute paths
  outside `rootPath` are rejected.
- `write` must be atomic (write-temp + rename) for local and
  sandbox providers. Cloud providers may relax to last-write-wins
  if the backend is eventually consistent; this must be declared
  in the provider's capabilities.
- `watch` is best-effort on every backend; callers must still
  refetch on reconnect.

### StreamProvider

Decouples "where output comes from" (subprocess PTY, SSE, WS,
queue fan-out) from "how the UI and the backend consume it". A
stream is a named, append-only sequence of `OutputChunk`s with
one publisher and many subscribers.

```typescript
interface StreamProvider {
  readonly type: "memory" | "pubsub" | "websocket" | "sse";

  publish(sourceId: string, chunk: OutputChunk): Promise<void>;
  subscribe(sourceId: string): AsyncIterable<OutputChunk>;
  close(sourceId: string): Promise<void>;
  lastSequenceId(sourceId: string): Promise<string | null>;
}
```

Notes:

- `sourceId` is typically `taskId`, but can be any namespaced
  identifier (e.g. heartbeat stream per device).
- Implementations must preserve chunk order and be replay-safe up
  to an implementation-defined buffer window (at least "since
  `lastSequenceId`"); the desktop agent's reconnect logic
  (§ 36) depends on this.

### CostProvider

Records usage events and exposes pricing. One implementation per
vendor, so that pricing tables and cost-optimal routing (§ 68)
stay out of the agent and router core.

```typescript
interface UsageEvent {
  taskId: string;
  agentId: string;
  vendor: AIVendor;
  model: string;                  // "claude-opus-4-7", "gpt-5", ...
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
  totalUsd: number;
  at: string;
}

interface PricingInfo {
  vendor: AIVendor;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheHitDiscountPct?: number;
  fetchedAt: string;
}

interface CostEstimate {
  taskId: string;
  vendor: AIVendor;
  model: string;
  lowUsd: number;
  highUsd: number;
  assumptions: string;
}

interface CostProvider {
  readonly vendor: AIVendor;

  recordUsage(event: UsageEvent): Promise<void>;
  estimate(task: Task): Promise<CostEstimate>;
  getPricing(model: string): PricingInfo;
}
```

Notes:

- All cost math, pricing-table freshness, and per-model
  discounts live in the CostProvider. The router (§ 68) asks for
  estimates; it does not compute them.
- `recordUsage` should be idempotent on `taskId + model`.

### Legacy LLM-completion shape

Historically SPEC defined a single `AIProvider` interface focused
on LLM completions. That shape is now the inner API used by
`AIAgent` implementations that wrap raw model calls (e.g. a
future `ClaudeChatAgent`). It is no longer the public contract;
core code must go through `AIAgent`, not `AIProvider`. The legacy
shape is retained internally in `packages/ai/llm` and is not
re-exported from `@operator-os/contracts`.

## Routing rules (configurable)

Default rules apply in order:
1. If user specified model → use that
2. If task type matches specialist model → use specialist
3. If context > 100K tokens → use long-context model
4. If "budget-optimize" flag → use cheapest capable
5. If "quality-first" flag → use best capable
6. Default: balanced (moderate quality, moderate cost)

## Specific provider integrations

### Anthropic (Claude)
- Models: Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
- Auth: API key or OAuth
- Special: supports thinking mode, code execution tool
- Rate limit: per-account

### OpenAI
- Models: GPT-5, GPT-5-Codex, GPT-5-mini
- Auth: API key
- Special: function calling, assistants API
- Rate limit: per-key

### Google AI
- Models: Gemini 3 Pro, Gemini 3 Flash, Nano Banana Pro (images)
- Auth: API key or ADC
- Special: 1M context, native image generation
- Rate limit: per-project

### Local (Ollama, LM Studio) — future
- Models: Llama 3, Mistral, etc.
- Auth: none (localhost)
- Special: zero cost, privacy-first
- Speed depends on user's hardware

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK VII — AGENT ORCHESTRATION ENGINE
═══════════════════════════════════════════════════════════════════════════════

§ 71. THE CONDUCTOR SERVICE

The conductor is the master orchestrator. It's the brain that decides
which agent does what.

## Core responsibilities

1. Route tasks to appropriate agents based on:
   - Task type
   - Agent capability
   - Agent availability
   - PC availability
   - User preferences
   - Cost constraints

2. Coordinate parallel execution:
   - Split large tasks into subtasks
   - Assign subtasks to different agents
   - Monitor progress
   - Merge results

3. Handle dependencies:
   - Task A must finish before Task B starts
   - Task B needs output of Task A as input
   - Coordinate handoff

4. Manage agent lifecycle:
   - Spawn new agents when needed
   - Suspend idle agents (resource conservation)
   - Kill unresponsive agents
   - Replace dead agents

## Task decomposition

Example input: "Make the API secure by adding auth, rate limiting, and logging."

Conductor decomposes to:
- Task 1: Add auth middleware (CC #1)
- Task 2: Add rate limiting (CC #2)
- Task 3: Add logging (CC #3)
- Task 4: Write tests for all three (CC #1 after Tasks 1-3)
- Task 5: Update docs (CC #2 after Task 4)
- Task 6: Open PR with all changes (any agent)

Dependency graph tracked. Tasks 1-3 parallel. Task 4 waits. Task 5 waits.

## Conductor state (Firestore)

conductorSessions/{sessionId}/
  userId
  masterTaskDescription
  status: "planning" | "executing" | "completed" | "failed"
  subtasks: [...]
  dependencyGraph: { ... }
  startedAt, updatedAt

## Agent selection algorithm

```python
def select_agent(task, available_agents):
    scored = []
    for agent in available_agents:
        if not agent.can_handle(task):
            continue

        score = 0
        score += agent.capability_match(task) * 50    # fit
        score -= agent.current_load * 20               # busy penalty
        score += agent.recent_success_rate * 30       # reliability
        score -= agent.cost_per_task * 10             # cost consideration

        scored.append((score, agent))

    return max(scored, key=lambda x: x[0])[1]
```

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK VIII — SECURITY & TRUST
═══════════════════════════════════════════════════════════════════════════════

§ 79. ZERO-TRUST ARCHITECTURE

## Principles

1. Never trust, always verify
   Every request authenticated, every device authorized.

2. Least privilege
   Every service has minimal permissions.
   Every user has minimal scopes.

3. Assume breach
   Design as if attacker is already inside.
   Limit blast radius.

4. Defense in depth
   Multiple layers of protection.
   No single point of failure.

## Authentication layers

Layer 1: TLS on all connections (Cloud Load Balancer)
Layer 2: JWT verification on API (signed tokens)
Layer 3: Device token verification (per-device auth)
Layer 4: OIDC between services (service-to-service)
Layer 5: Signed commands (prevent replay attacks)

## Command signing

Every command from backend to desktop agent is signed.

Process:
1. Backend generates command with nonce + timestamp
2. Signs with service private key (Ed25519)
3. Desktop agent verifies with public key (cached, rotated weekly)
4. Agent rejects if:
   - Signature invalid
   - Timestamp too old (> 5 min)
   - Nonce already seen (replay)
   - User/device doesn't match

This prevents:
- Man-in-the-middle attacks
- Replay attacks
- Impersonation of backend
- Malicious commands even if WebSocket compromised

═══════════════════════════════════════════════════════════════════════════════

§ 80. END-TO-END ENCRYPTION (Phase 3)

## Current approach: TLS + server-side encryption

For MVP, we rely on:
- TLS 1.3 between all layers
- Server-side encryption at rest (Firestore, Cloud Storage)
- Secrets in Secret Manager (HSM-backed)

## Future: true end-to-end

For enterprise users, add option:
- Client-side encryption before sending to server
- Server never sees plaintext of user data
- Keys held by user (possibly via hardware token)

Scope for Phase 3. Not MVP. Document as roadmap item.

═══════════════════════════════════════════════════════════════════════════════

§ 85. KILL-SWITCH MECHANISMS

Multiple ways to stop everything immediately.

## User-triggered

### Mobile: Emergency stop button
Settings → Emergency Stop
Big red button. Confirmation dialog.
Sends cancel to all running tasks, all agents, all PCs.

### Mobile: Per-task stop
Tap [Stop] on any active task.
Cancels that specific task.

### Mobile: Per-PC pause
"Pause all on Home PC" → no new commands accepted.
Running commands complete normally.

### Desktop: Tray icon kill switch
Right-click tray → Emergency Stop
Same as mobile.

### Desktop: Keyboard shortcut
User-configurable. Default: Ctrl+Shift+Alt+K
Triggers emergency stop.

## System-triggered

### Budget exceeded
Automatic: pause new commands if budget 100% reached.
User must explicitly raise budget or wait for period reset.

### Security anomaly
Detected by audit system:
- Unusual command patterns
- Login from unexpected location
- Multiple failed auth attempts
Action: pause all, notify user, require re-auth.

### Provider failure
If primary AI provider down:
- Try fallback chain
- If all fail: pause tasks requiring AI, notify user.

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK IX — OBSERVABILITY
═══════════════════════════════════════════════════════════════════════════════

§ 88. LOGGING STANDARDS

## Every log entry must include

- timestamp (ISO 8601 with milliseconds)
- service (service name)
- severity (DEBUG|INFO|WARN|ERROR|FATAL)
- event (structured event name)
- traceId (distributed tracing)
- spanId (within trace)
- userId (if user-scoped action)
- deviceId (if device-scoped)
- taskId (if task-scoped)

## Examples

```json
{
  "ts": "2026-04-22T14:32:15.234Z",
  "service": "operator-api",
  "severity": "INFO",
  "event": "task.created",
  "traceId": "01HGX...",
  "spanId": "01HGY...",
  "userId": "user-akmal",
  "deviceId": "mobile-ios",
  "taskId": "task-uuid-123",
  "payload": {
    "pcId": "pc-home",
    "agentId": "claude-code-1",
    "descriptionHash": "sha256:..."
  }
}
```

## Log levels

DEBUG: Development-only. Disabled in production by default.
INFO: Normal operations. Searchable, kept 30 days.
WARN: Unexpected but not failure. Kept 90 days.
ERROR: Something failed. Alerted if rate exceeds threshold.
FATAL: Service-level failure. Pages on-call immediately.

## What NOT to log

- User passwords (never)
- API tokens (never)
- Credit card numbers (never)
- Full task descriptions (hash only, unless debug with user consent)
- Private keys (never)
- AI completion outputs (metadata only unless explicit opt-in)

═══════════════════════════════════════════════════════════════════════════════

§ 89. METRICS CATALOG

## System health metrics

- http_requests_total{service, endpoint, status}
- http_request_duration_seconds{service, endpoint}
- websocket_connections_active{service}
- websocket_messages_total{service, direction}
- pubsub_messages_published_total{topic}
- pubsub_messages_consumed_total{subscription}
- pubsub_consumer_lag_messages{subscription}

## Business metrics

- users_registered_total
- users_active_daily (unique userIds in last 24h)
- users_active_mobile_daily
- tasks_created_total{pcId, agentType}
- tasks_completed_total{status, duration_bucket}
- tasks_failure_rate
- commands_executed_total{commandType}

## Cost metrics

- tokens_consumed_total{provider, model, userId}
- dollars_spent_total{provider, userId}
- tasks_per_user_daily{userId}
- cost_per_active_user

## Agent metrics

- agents_online_total{pcId}
- agent_utilization_percent{pcId, agentId}
- subprocess_duration_seconds{commandType}
- subprocess_exit_codes{commandType, exitCode}

## User experience metrics

- app_startup_time_ms{platform, version}
- task_creation_latency_ms{platform}
- notification_delivery_rate
- websocket_reconnection_rate

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK X — COST INTELLIGENCE
═══════════════════════════════════════════════════════════════════════════════

§ 96. TOKEN TRACKING

## Data model

```
tokenUsage/{recordId}/
  userId
  taskId
  commandId
  provider: "anthropic" | "openai" | "google"
  model: "claude-opus-4-7"
  inputTokens: 1234
  outputTokens: 567
  cachedInputTokens: 100
  timestamp
  costUsd: 0.42
```

Stored in Firestore + BigQuery for analytics.

## Ingestion path

1. AI provider returns response with usage
2. ai-router service parses usage
3. Writes tokenUsage record
4. Publishes event "tokens.consumed"
5. cost-tracker service subscribes
6. Updates user's running totals in cache (Redis)
7. Checks budget thresholds
8. Alerts if needed

## Pricing table (maintained)

```
pricing/{provider}/{model}/
  inputPerMillion
  outputPerMillion
  cachedInputPerMillion
  effectiveDate
  currency: "USD"
```

Updated when providers change pricing.
Historical pricing preserved for accurate past-period calculations.

═══════════════════════════════════════════════════════════════════════════════

§ 99. "COULD HAVE SAVED" ANALYSIS

## The insight

After task completes, analyze: could a cheaper model have done this?

## Algorithm

1. Task classification (simple vs complex)
2. Based on prompt/output analysis:
   - Was prompt under 500 tokens? → maybe Haiku sufficient
   - Was output straightforward? → maybe Flash sufficient
   - Did it require reasoning? → probably needed Opus
3. Estimate cost if cheaper model used
4. Store as "potential saving"
5. Sum across month for user report

## Presentation

Weekly email:
"You saved $X this week using the right models.
You could have saved another $Y by using cheaper models for 12 routine tasks.
Want us to auto-route these next time? [Enable auto-routing]"

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK XIV — EXECUTION PLAN
═══════════════════════════════════════════════════════════════════════════════

§ 127. 6-WEEK SPRINT BREAKDOWN

## Overview

6 weeks to demo-ready product.
Parallel execution using multiple Claude Code agents.

## Week-by-week

### Week 1: Foundation & Security
- TD-005: auth on /v1/agent/* and /v1/ai/*
- TD-003 + TD-008: deploy pipeline hygiene
- auth-gateway service
- Provider registration
- Desktop Agent SPEC (documentation only)
- Mobile app project init

### Week 2: Desktop Agent v1
- Core Node.js agent
- WebSocket client
- Command execution (claude-code executor)
- Local SQLite for state
- Windows Service packaging
- Installer with pairing flow
- Local testing by Akmal

### Week 3: Mobile App Core
- React Native + Expo project
- Navigation structure
- Auth flow (Google sign-in)
- PC pairing flow
- Home screen
- Task Composer
- Live Terminal view (MVP)
- First end-to-end test: send task from phone, see it run

### Week 4: GitHub Integration + Notifications
- Backend: github-integration endpoints
- Mobile: PR list screen
- Mobile: Diff viewer
- Mobile: PR actions (approve, merge)
- notifications service
- Push notifications wired (FCM + APNs)

### Week 5: Multi-Agent + AI Router
- ai-router service
- Multi-provider support (Claude, GPT, Gemini)
- conductor service for orchestration
- Agent coordination screen
- cost-tracker service
- Cost dashboard screen

### Week 6: Polish + Demo + Launch
- Bug fixing
- UX polish
- Performance optimization
- Demo video production
- Landing page
- Waitlist/beta signup
- Launch post
- Product Hunt preparation

═══════════════════════════════════════════════════════════════════════════════

§ 134. PARALLEL WORKSTREAMS

To finish in 6 weeks, we run multiple Claude Code agents in parallel.

## Stream A: Backend (continuous)
Claude Code on D:\Operator-OS-Dev
- Week 1: Security fixes + auth-gateway
- Week 2: Device/pairing endpoints
- Week 3: WebSocket + streamer
- Week 4: Integration endpoints
- Week 5: AI router + cost tracker
- Week 6: Bug fixes

## Stream B: Desktop Agent (Weeks 2-6)
Claude Code on D:\Operator-OS-Desktop-Agent
- Week 2: Core agent + WebSocket + executors
- Week 3: Installer + service packaging
- Week 4: macOS port
- Week 5: Linux port + auto-update
- Week 6: Polish

## Stream C: Mobile App (Weeks 3-6)
Claude Code on D:\Operator-OS-Mobile
- Week 3: Core screens (home, task, terminal)
- Week 4: GitHub screens (PRs, diff viewer)
- Week 5: Multi-agent + cost screens
- Week 6: Polish, animations, app store prep

## Stream D: Infrastructure (as needed)
Claude Code on D:\Operator-OS-Infra
- IAM, networking, deployments
- Terraform definitions
- CI/CD workflows
- Monitoring setup

## Stream E: Launch Prep (Weeks 5-6)
Claude Code on D:\Operator-OS-Launch
- Landing page
- Demo video script
- Blog post drafts
- Social media content
- Waitlist backend

═══════════════════════════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════════════════════════
BOOK XV — OPERATIONAL RULES
═══════════════════════════════════════════════════════════════════════════════

§ 137. RULES R1-R50 FOR CLAUDE CODE AGENTS

These are standing orders for all Claude Code agents working on this project.

R1. TypeScript strict mode always. No `any`. Zod validation at boundaries.

R2. Atomic commits. One concern per commit. Conventional Commits format.

R3. Never commit without passing: pnpm typecheck + pnpm test + pnpm lint.

R4. No AI attribution in commits. No "Co-authored by Claude". Author: Akmal <hujdarovakmal@gmail.com>.

R5. Never secrets in code. Only Secret Manager + .env (gitignored).

R6. Large tasks (>30 lines or >3 files) require plan before code. Wait for user go.

R7. Order: Planning → Implementation → Testing → Docs. No shortcuts.

R8. GCP changes (deploy, IAM, secrets) require double-check. Show command, wait confirmation.

R9. Image tags: explicit git SHA. Never :latest in prod.

R10. All HTTP endpoints: Zod validation in, typed response out.

R11. Error handling: try/catch with structured logging. Context required (runId, taskId).

R12. No console.log. Structured logger only.

R13. Tests for every new business logic function. Unit required. Integration for critical paths.

R14. External API calls: timeout (30s max), retry (3 max, exp backoff), rate limit, categorize errors.

R15. Docs updated in same commit as code changes.

R16. Long responses (plans, diagnostics, >500 words) saved to docs/sessions/YYYY-MM-DD-HHMM-topic.md.

R17. Prompt templates in packages/prompts/. Never hardcoded.

R18. Voice rules in packages/voice/. One file per niche/context.

R19. Firestore reads cached where possible. 10min for config, 1h for learning insights.

R20. Pub/Sub messages idempotent. Subscribers handle duplicates.

R21. Aggressive push to remote. Commit + push every atomic unit.

R22. Comprehensive commit history. Detailed messages explain why, not just what.

R23. Final reports in BLOCK format for easy copy-paste.

R24. Session logging parallel to terminal output.

R25. Security changes (auth, secrets, rate limits) STOP before deploy, require explicit "deploy go".

R26. Cloud Run services: min-scale 0, max-scale reasonable, cpu-throttling on, startup-boost on.

R27. Health endpoints: /health (alive) and /ready (honest per LAW #5).

R28. Database migrations: forward-compatible. Old code must work with new schema.

R29. Feature flags via env vars for gradual rollout.

R30. Mobile: respect platform conventions (iOS HIG, Material Design).

R31. Mobile: accessibility (VoiceOver, TalkBack) for all interactive elements.

R32. Desktop agent: run in user session, not SYSTEM (for env access).

R33. Desktop agent: all subprocess output captured and logged.

R34. Desktop agent: commands validated before execution (signature + allowlist).

R35. WebSocket: automatic reconnection with exponential backoff.

R36. All services: graceful shutdown on SIGTERM (drain connections, flush logs).

R37. Deployment: blue/green or canary for user-facing services.

R38. Rollback: always possible within 60 seconds.

R39. User data: export always possible, delete always honored.

R40. Privacy: no user data in analytics without consent.

R41. Performance: mobile app p95 screen load < 1 second.

R42. Performance: API p95 latency < 500ms.

R43. Performance: WebSocket reconnection < 3 seconds.

R44. Error messages: specific, actionable, not technical jargon.

R45. UI: loading states for everything > 300ms.

R46. UI: empty states for every list.

R47. UI: error states for every data fetch.

R48. Testing: E2E tests for critical user journeys.

R49. Code review: self-review before requesting Akmal. Explain design choices.

R50. When in doubt: stop and ask. Don't guess on architectural decisions.

═══════════════════════════════════════════════════════════════════════════════

§ 143. COMMUNICATION PROTOCOLS (Claude → Akmal)

## When to report

- After each atomic commit: brief status (1-2 lines)
- After each major milestone: BLOCK format report
- Before deploys: plan + approval request
- When blocked: immediate escalation with options
- Daily (if long-running): progress summary

## What format

BLOCK format for structured reports:
- BLOCK 1-8 as defined in P0.1 final report
- Copy-paste ready
- URLs separate
- Commands separate
- Summary separate

## Escalation triggers

Immediate escalation if:
- Security issue discovered
- Data loss risk detected
- Breaking change needed
- Architectural decision ambiguous
- User intent unclear
- External dependency failing

## What NOT to do

- Don't make business decisions
- Don't change scope without approval
- Don't push to main directly
- Don't deploy without explicit approval
- Don't modify user data without explicit approval

═══════════════════════════════════════════════════════════════════════════════
END OF MASTER SPECIFICATION
═══════════════════════════════════════════════════════════════════════════════

This document is the source of truth for Operator-OS development.
All Claude Code agents working on this project must respect this spec.
Deviations require explicit user approval.

Version: 1.0
Last updated: 2026-04-22
Owner: Akmal Khujdarov (BusyaPrime)

The 5 Architectural Laws are non-negotiable.
Every feature must pass all 5.
Every design decision must honor all 5.

Build well. Ship fast. Honor the user.

— End of Document —
