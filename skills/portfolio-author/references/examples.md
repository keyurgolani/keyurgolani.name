# Examples: three abridged real-world drafts

> Three personas showing the curation principles in action. Loaded when
> the user is unsure of tone or hasn't seen platform output before.
> Examples are intentionally abridged; real portfolios will have more
> records. Each example below is a schema-valid version 3 `portfolio.yml`
> that pairs with a `site.yml` copied from `site.example.yml`; copy-paste and
> extend.

## Senior backend engineer (job hunt)

> Persona: Anamika Devi, 11 years at FAANG-equivalents, currently looking.
> Curation: the path forward, metrics up top to set context, skills near the
> bottom. The numbers are metric evidence with keys, so a figure stated twice
> is checked.

```yaml
schemaVersion: 3
locale: en
direction: ltr

identity:
  name: Anamika Devi
  tagline: Distributed systems engineer for pricing, search, and rendering at scale.
  location: Bangalore, India
  email: anamika@example.com
links:
  - { url: 'https://github.com/anamika', platform: github }
  - { url: 'https://linkedin.com/in/anamika', platform: linkedin }
  - { url: '/resume.pdf', platform: resume }

signature: blink
proof: [tenure-years, daily-transactions-priced, pricing-p99]

practice:
  skills:
    - { name: Distributed systems, items: [Rust, Java, Go, gRPC, Kafka, etcd] }
    - { name: Storage, items: [PostgreSQL, RocksDB, S3] }

works:
  - id: blink
    title: blink
    medium: software
    summary: A key-value store with predictable tail latency.
    description: Sub-millisecond key-value store. Used in three production services.
    links: [{ url: 'https://github.com/anamika/blink', platform: github }]

evidence:
  - id: tenure-years
    type: metric
    statement: Years building revenue-critical infrastructure
    metric: { key: tenure-years, value: 11, unit: years }
  - id: daily-transactions-priced
    type: metric
    statement: Daily transactions priced by the service I rewrote
    metric: { key: daily-transactions-priced, value: 8000000000 }
  - id: pricing-p99
    type: metric
    statement: P99 latency after the rewrite, down from 380ms
    metric: { key: pricing-p99-ms, value: 42, unit: ms }

chronology:
  - id: senior-sde-amazon
    kind: role
    title: Senior SDE
    organization: Amazon
    period: { start: 2019-03 }
    highlights:
      - Owned the pricing service rewrite (Java to Rust); P99 dropped 9x.
      - Designed the shadow-traffic harness that caught 4 production-blocking issues pre-launch.

contact:
  message: Open to senior-IC and tech-lead roles. Happiest at companies where infra owns business outcomes.

sections:
  - kind: hero
    id: top
    tagline: Building systems that matter at scale.
    subtagline: 11 years across pricing, search, and ad rendering. Currently exploring new roles.
  - kind: lede
    id: about
    body: |
      I work at the intersection of distributed systems and revenue-critical
      infrastructure. Most recently led the rewrite of a pricing service
      that decided 8B+ daily transactions, cutting tail latency from 380ms
      to 42ms. Now I want to work on inference-time serving.
  - kind: evidence
    id: by-the-numbers
    items: [tenure-years, daily-transactions-priced, pricing-p99]
  - kind: chronology
    id: experience
    title: Experience
  - kind: works
    id: projects
    title: Projects
    items: [blink]
  - kind: practice
    id: skills
    title: Skills
    part: skills
  - kind: contact
    id: contact
    title: Contact
```

## Designer-engineer (personal brand)

> Persona: Theo Brand, indie maker, mid-career. Wants a body of work, not a job pitch.
> Curation: tools and essays are the body, as works of two media; no
> chronology at all. The works are the resume.

```yaml
schemaVersion: 3
locale: en
direction: ltr

identity:
  name: Theo Brand
  tagline: Designer-engineer making small, opinionated tools.
  location: Lisbon, Portugal
  email: theo@example.com
links:
  - { url: 'https://github.com/theobrand', platform: github }
  - { url: 'https://theobrand.studio', platform: website }

signature: quietly
featured: [margin]

works:
  - id: quietly
    title: Quietly
    medium: software
    summary: A focus timer that stops nagging.
    description: Mac menu-bar app that respects your attention. ~30k installs, fully local, no telemetry.
    links: [{ url: 'https://quietly.app', platform: website }]
  - id: margin
    title: Margin
    medium: software
    summary: Annotated reading for the web.
    description: Browser extension turning long-form articles into reading sessions with margin notes that sync across devices.
  - id: on-legible-interfaces
    title: On legible interfaces
    medium: writing
    publication: theobrand.studio
    publishedAt: 2024-09
    url: 'https://theobrand.studio/legible'
  - id: the-cost-of-a-setting
    title: The cost of a setting
    medium: writing
    publication: theobrand.studio
    publishedAt: 2024-04
    url: 'https://theobrand.studio/setting-cost'

contact:
  message: I read every email. Slow but eventual.

sections:
  - kind: hero
    id: top
    tagline: Small tools. Strong opinions.
    subtagline: I design and build software for people who like software.
  - kind: lede
    id: about
    body: |
      I've been making tools on the open web for ten years. Some get used by
      tens of thousands of people; most get used by me. I write about what
      I learn at the seam between design and code, and I ship something
      small most months.
  - kind: focus
    id: focus
    items: [Local-first software, Type design, Calm UI]
  - kind: works
    id: tools
    title: Tools
    items: [quietly, margin]
  - kind: works
    id: writing
    title: Writing
    items: [on-legible-interfaces, the-cost-of-a-setting]
  - kind: github
    id: github
    username: theobrand
    showLanguageBreakdown: true
  - kind: contact
    id: contact
    title: Contact
```

## Maker-photographer hybrid (collaboration)

> Persona: Kai Park, open-source tools by day, street photography by night.
> Curation: works and github for the engineering; external-work evidence sends
> photo-curious readers to the dedicated site without picking a side.

```yaml
schemaVersion: 3
locale: en
direction: ltr

identity:
  name: Kai Park
  tagline: Software by day, street photography by night.
  location: Seoul, South Korea
  email: kai@example.com
links:
  - { url: 'https://github.com/kaipark', platform: github }
  - { url: 'https://kaipark.photography', platform: website }

works:
  - id: lensview
    title: lensview
    medium: software
    description: CLI for diffing image metadata across a directory tree. Useful when you don't trust your filesystem.
    links: [{ url: 'https://github.com/kaipark/lensview', platform: github }]
  - id: nightshade
    title: nightshade
    medium: software
    description: Tiny static-site generator focused on photo essays. Powers my photography site.

evidence:
  - id: kaipark-photography
    type: external-work
    title: kaipark.photography
    description: Street photography from Seoul, after dark.
    url: 'https://kaipark.photography'
    iconName: camera

contact:
  message: Open to collaborations on tools or commissioned photo work. Email is the best channel.

sections:
  - kind: hero
    id: top
    tagline: Two practices, one person.
    subtagline: Open-source tooling and street photography. Both about looking carefully.
  - kind: lede
    id: about
    body: |
      I split my time between writing developer tools and walking with a
      camera. The tools are small, opinionated, and open. The photographs
      are mostly Seoul, mostly at the hour after the lights come on.
  - kind: works
    id: projects
    title: Projects
    items: [lensview, nightshade]
  - kind: github
    id: github
    username: kaipark
  - kind: evidence
    id: elsewhere
    title: Elsewhere
    items: [kaipark-photography]
  - kind: contact
    id: contact
    title: Contact
```
