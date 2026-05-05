# Examples — three abridged real-world drafts

> Three personas showing the curation principles in action. Loaded when
> the user is unsure of tone or hasn't seen platform output before.
> Examples are intentionally abridged — real portfolios will have more
> items per section. Each example below is schema-valid; copy-paste and
> extend.

## Senior backend engineer (job hunt)

> Persona: Anamika Devi, 11 years at FAANG-equivalents, currently looking.
> Curation: experience-forward, stats up top to set context, skills near bottom.

```yaml
identity:
  name: Anamika Devi
  tagline: Distributed systems engineer — pricing, search, rendering at scale.
  location: Bangalore, India
  email: anamika@example.com
variant: editorial
links:
  - { url: 'https://github.com/anamika', platform: github }
  - { url: 'https://linkedin.com/in/anamika', platform: linkedin }
  - { url: '/resume.pdf', platform: resume }
sections:
  - kind: hero
    tagline: Building systems that matter at scale.
    subtagline: 11 years across pricing, search, and ad rendering. Currently exploring new roles.
  - kind: lede
    body: |
      I work at the intersection of distributed systems and revenue-critical
      infrastructure. Most recently led the rewrite of a pricing service
      that decided 8B+ daily transactions, cutting tail latency from 380ms
      to 42ms. Now I want to work on inference-time serving.
  - kind: tenure
    years: 11
  - kind: stats
    items:
      - { value: '8B+', label: Daily transactions priced }
      - { value: '42ms', label: P99 latency post-rewrite }
      - { value: '$1.2B', label: Revenue surface owned }
  - kind: experience
    items:
      - role: Senior SDE
        organization: Amazon
        period: { start: 2019-03 }
        highlights:
          - Owned the pricing service rewrite (Java to Rust); P99 dropped 9x.
          - Designed the shadow-traffic harness that caught 4 production-blocking issues pre-launch.
  - kind: projects
    items:
      - name: blink
        description: Sub-millisecond key-value store with predictable tail latency. Used in three production services.
        links: [{ url: 'https://github.com/anamika/blink', platform: github }]
  - kind: skills
    groups:
      - { name: Distributed systems, items: [Rust, Java, Go, gRPC, Kafka, etcd] }
      - { name: Storage, items: [PostgreSQL, RocksDB, S3] }
  - kind: contact
    message: Open to senior-IC and tech-lead roles. Happiest at companies where infra owns business outcomes.
```

## Designer-engineer (personal brand)

> Persona: Theo Brand, indie maker, mid-career. Wants a body of work, not a job pitch.
> Curation: projects/writings as body, no experience section — the projects are the resume.

```yaml
identity:
  name: Theo Brand
  tagline: Designer-engineer making small, opinionated tools.
  location: Lisbon, Portugal
  email: theo@example.com
variant: editorial
links:
  - { url: 'https://github.com/theobrand', platform: github }
  - { url: 'https://theobrand.studio', platform: website }
sections:
  - kind: hero
    tagline: Small tools. Strong opinions.
    subtagline: I design and build software for people who like software.
  - kind: lede
    body: |
      I've been making tools on the open web for ten years. Some get used by
      tens of thousands of people; most get used by me. I write about what
      I learn at the seam between design and code, and I ship something
      small most months.
  - kind: focus
    items: [Local-first software, Type design, Calm UI]
  - kind: projects
    items:
      - name: Quietly
        summary: A focus timer that stops nagging.
        description: Mac menu-bar app that respects your attention. ~30k installs, fully local, no telemetry.
        links: [{ url: 'https://quietly.app', platform: website }]
      - name: Margin
        summary: Annotated reading for the web.
        description: Browser extension turning long-form articles into reading sessions with margin notes that sync across devices.
  - kind: writings
    items:
      - { title: On legible interfaces, publication: theobrand.studio, publishedAt: 2024-09, url: 'https://theobrand.studio/legible' }
      - { title: The cost of a setting, publication: theobrand.studio, publishedAt: 2024-04, url: 'https://theobrand.studio/setting-cost' }
  - kind: github
    username: theobrand
    showLanguageBreakdown: true
  - kind: contact
    message: I read every email. Slow but eventual.
```

## Maker-photographer hybrid (collaboration)

> Persona: Kai Park, open-source tools by day, street photography by night.
> Curation: projects + github for the engineering, external-portfolios sends
> photo-curious readers to the dedicated site without picking a side.

```yaml
identity:
  name: Kai Park
  tagline: Software by day, street photography by night.
  location: Seoul, South Korea
  email: kai@example.com
variant: editorial
links:
  - { url: 'https://github.com/kaipark', platform: github }
  - { url: 'https://kaipark.photography', platform: website }
sections:
  - kind: hero
    tagline: Two practices, one person.
    subtagline: Open-source tooling and street photography. Both about looking carefully.
  - kind: lede
    body: |
      I split my time between writing developer tools and walking with a
      camera. The tools are small, opinionated, and open. The photographs
      are mostly Seoul, mostly at the hour after the lights come on.
  - kind: projects
    items:
      - name: lensview
        description: CLI for diffing image metadata across a directory tree. Useful when you don't trust your filesystem.
        links: [{ url: 'https://github.com/kaipark/lensview', platform: github }]
      - name: nightshade
        description: Tiny static-site generator focused on photo essays. Powers my photography site.
  - kind: github
    username: kaipark
  - kind: external-portfolios
    items:
      - url: 'https://kaipark.photography'
        brandName: kaipark.photography
        description: Street photography from Seoul, after dark.
        iconName: camera
  - kind: contact
    message: Open to collaborations on tools or commissioned photo work. Email is the best channel.
```
