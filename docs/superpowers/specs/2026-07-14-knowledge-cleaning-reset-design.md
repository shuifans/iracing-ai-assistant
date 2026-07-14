# Knowledge Cleaning Reset Design

**Date:** 2026-07-14

## Objective

Rebuild the knowledge-cleaning subsystem around a single OpenAI-compatible LLM path, remove every Qoder SDK dependency from knowledge cleaning while preserving Qoder-based chat/agent behavior, replace the current taxonomy with an iRacing-specific taxonomy, strengthen the cleaning prompt for professional and official racing content, and reset the existing low-quality knowledge data so future content is controlled through the administrator review workflow.

The resulting knowledge base follows a lightweight, file-first interpretation of Andrej Karpathy's LLM Wiki pattern: immutable source material, one durable Markdown note compiled from each source, a compact routing index, and explicit instructions for a read-only retrieval agent. It intentionally does not build a knowledge graph or compile one source into multiple concept pages.

## Scope

This change covers knowledge source ingestion and immutable snapshots, asynchronous cleaning jobs, cleaning prompts, Front Matter validation, knowledge taxonomy, note shape, agent-facing index and schema files, draft evaluation, the knowledge-management UI, and a one-time knowledge-domain reset.

It does not remove the Qoder SDK package or alter the chat answer pipeline, Wiki retrieval agent, web research agent, or their configuration. It does not add automatic publication or bypass human review. It does not add entity pages, concept pages, backlinks, related-page graphs, multi-note ingest changesets, vector embeddings, or knowledge-graph maintenance.

## Architecture

The knowledge base has three lightweight layers:

1. **Source layer:** immutable uploaded files and immutable normalized text snapshots. A submitted URL is fetched once and its extracted text is snapshotted; the worker does not re-fetch a changing URL for the same source record.
2. **Note layer:** exactly one reviewed Markdown note for each knowledge source. The note contains a routing summary and a source-grounded body.
3. **Agent schema layer:** `index.md` routes the agent to candidate notes and `KNOWLEDGE.md` defines the read-only query protocol and citation rules.

The knowledge pipeline has one cleaning path:

```text
immutable uploaded file or HTTPS URL snapshot
  -> source validation and deduplication
  -> asynchronous knowledge job
  -> deterministic text extraction
  -> OpenAI-compatible LLM cleaning
  -> Front Matter and output-size validation
  -> draft persistence
  -> heuristic and retrieval evaluation
  -> administrator edit, feedback/re-clean, approve or reject
  -> one-note Wiki publication, index rebuild and Git commit
```

The worker always calls `cleanWithLlmDirect`. It does not read a cleaning-backend setting, construct a Qoder cleaning agent, or fall back to Qoder. Multiple OpenAI-compatible providers may still be tried in the configured order. A selected provider's quota error follows the existing `STOP_ON_LLM_RATE_LIMIT` behavior.

## Removal of Qoder from Knowledge Cleaning

Remove these knowledge-cleaning capabilities:

- The Qoder branch in the knowledge worker and its SDK message-consumption and idle-timeout helpers.
- `createCleaningQuery` from the agent client.
- `KNOWLEDGE_CLEANER_PROMPT` from the agent prompt registry.
- The `knowledge.cleaning_backend` reader, enum and constants.
- The password-gated knowledge-cleaning backend API.
- The cleaning-backend switch component and its knowledge-page integration.
- Cleaning-specific Qoder environment documentation and tests.

Preserve these capabilities:

- `@qoder-ai/qoder-agent-sdk` as a dependency used by chat and agent workflows.
- `CHAT_ANSWER_BACKEND`, Qoder chat timeouts, Wiki search and web research agents.
- Agent prompt and client code that is used by chat rather than cleaning.

The knowledge page no longer offers a model selector. Initial cleaning and reviewer-feedback re-cleaning both use the same direct LLM cleaner. Re-cleaning replaces the candidate version for the same source lineage; it does not create additional topic or entity notes.

## Knowledge Taxonomy

The taxonomy is a strict mapping. A subcategory is valid only under its declared parent category.

### `official-racing`

- `schedule-and-season`
- `series-and-events`
- `sporting-code`
- `race-procedures`
- `licenses-and-ratings`
- `protests-and-penalties`
- `special-events`

### `getting-started`

- `account-and-membership`
- `content-and-purchasing`
- `installation-and-configuration`
- `first-race`
- `ui-and-registration`
- `leagues-and-hosted-racing`
- `troubleshooting`

### `driving-technique`

- `driving-fundamentals`
- `racing-line`
- `braking`
- `cornering`
- `racecraft`
- `starts-and-restarts`
- `overtaking-and-defense`
- `tire-management`
- `wet-weather`
- `telemetry-analysis`

### `car-setup`

- `setup-fundamentals`
- `tires-and-pressures`
- `suspension`
- `alignment`
- `aerodynamics`
- `drivetrain-and-gearing`
- `brakes`
- `electronics`
- `oval-setup`
- `presets-and-tools`

### `cars-and-tracks`

- `car-reference`
- `car-guide`
- `track-reference`
- `track-guide`

### `hardware-and-software`

- `wheels-and-pedals`
- `force-feedback`
- `vr-and-displays`
- `pc-and-performance`
- `telemetry-tools`
- `third-party-apps`

The previous taxonomy and Wiki paths do not require migration because the knowledge domain will be reset. TypeScript schema types, publisher types, validation, evaluation, filtering and prompt text must all use the new mapping.

## Front Matter

Every cleaned document starts with YAML Front Matter and contains:

```yaml
---
id: <stable note ID derived from the source lineage>
title: <1-200 characters>
description: <one-sentence routing summary, maximum 300 characters>
category: <one of the six categories>
subcategory: <a subcategory valid for the selected category>
tags: [<1-10 source-grounded tags>]
aliases: [<optional alternate names useful for exact search>]
source_id: <immutable source record ID>
source_name: <optional source publisher or document name>
source_url: <optional valid URL; omit for uploads without a URL>
source_sha256: <SHA-256 of the immutable source snapshot>
content_type: <optional content type>
season: <optional source-stated iRacing season>
effective_date: <optional source-stated ISO date>
expires_at: <optional source-stated ISO date>
updated_at: <optional source-stated ISO date>
---
```

`content_type` is optional and restricted to:

- `schedule`
- `sporting-rule`
- `series-guide`
- `beginner-guide`
- `driving-guide`
- `setup-guide`
- `car-reference`
- `track-reference`
- `hardware-guide`
- `software-guide`
- `other`

`id`, `source_id` and `source_sha256` are trusted metadata supplied by the application, not invented by the model. Dates, season identifiers, source names and URLs may be emitted only when present in the source or supplied as trusted source metadata. The cleaner must not infer them. `description`, `tags` and `aliases` are deliberately optimized for exact file search and index routing, but must still be grounded in the source.

The Front Matter parser and serializer must support the complete declared schema without relying on ambiguous hand-written YAML behavior.

## Note Shape

Every source compiles to exactly one Markdown note with this body structure:

```markdown
# <title>

## Summary

Three to six concise, source-grounded takeaways that help an agent decide whether the note is relevant.

## Applicability

The source-stated car, track, series, season, weather, hardware, user level or other scope constraints. Omit the section when none are stated.

## Details

The complete cleaned professional content, organized with H3 sections where useful.

## Key Data, Schedule, Rules, or Steps

Use the content-appropriate form: Markdown tables for schedules/data, ordered lists for procedures, and explicit rule lists for regulations. Use a more specific H2 title when appropriate.

## Limitations and Review Notes

Source-stated limitations plus visible conflicts, missing pages or truncation that require administrator review. Omit when empty.

## Source

The original source name and URL or uploaded filename.
```

The headings define information roles rather than mandatory empty sections. A note omits inapplicable sections and may rename the content-specific data section, but it always contains `Summary`, `Details`, and `Source`. The summary accelerates routing; the details remain the evidence used for final answers. The cleaner must not replace the body with a compressed summary.

## Cleaning Prompt

The system prompt identifies the model as a professional knowledge editor for the iRacing simulator and establishes this priority order:

1. Factual fidelity.
2. Completeness of material facts.
3. Clear information structure.
4. Concision.

General rules:

- Use the source language.
- Do not add facts, recommendations, dates, values, causal claims or conclusions absent from the source.
- Preserve technical terminology, numbers, units, limits, conditions, exceptions, warnings, notes and citations.
- Remove navigation, advertising, cookie notices, repeated headers and footers, unrelated recommendations and comment noise.
- Preserve meaningful tables, ordered procedures and warning blocks.
- Use a clear H1 and logical H2/H3 hierarchy.
- Produce exactly one note for the supplied source; do not split it into entity or concept pages.
- Follow the declared note shape, keeping `Summary` short and `Details` sufficiently complete for citation.
- Generate exact-search-friendly `description`, `tags` and `aliases` using terminology actually present in the source.
- Use the strict category-to-subcategory mapping.
- Return only the cleaned Markdown document.
- Reviewer feedback may improve structure, classification and wording but may not override source facts.

Content-specific rules:

- Official schedules preserve the season, week, dates, series, cars, tracks, session times and stated timezone. The cleaner does not convert timezones.
- Sporting Code and rule documents preserve applicability, thresholds, exceptions, penalties and modal force; `may`, `should` and `must` are not interchangeable.
- Beginner material preserves prerequisites, action order, UI labels and failure conditions.
- Driving and setup material preserves applicable car, track, weather, tire state, measurement units and operating conditions. Local experience is not generalized into a universal rule.
- Conflicting, incomplete or visibly truncated source material is marked in the draft as requiring administrator review rather than repaired by invention.

Before responding, the model performs an internal checklist for source grounding, one-source/one-note compliance, taxonomy validity, metadata validity, routing terms, hierarchy, preserved tables and absence of surrounding commentary. The checklist itself is not output.

## Agent Retrieval Contract

The published Wiki root contains `KNOWLEDGE.md`. It instructs a future Qoder SDK retrieval agent to:

1. Remain read-only and use only retrieval tools such as `Read`, `Grep` and `Glob` for the Wiki.
2. Read `index.md` first for category, description, aliases, season and validity routing.
3. Use exact terms, aliases, series/car/track names and tags to narrow the candidate set.
4. Read only the small set of candidate note bodies needed to answer the question.
5. Treat `Details` and source-preserved tables or rules as evidence; do not treat the short summary as sufficient when precision matters.
6. Cite both the Wiki note title/path and its original source metadata.
7. Distinguish sourced facts from the agent's synthesis and state when the Wiki lacks sufficient evidence.
8. Prefer current, applicable notes using season and effective/expiry metadata, while identifying conflicting or stale notes rather than silently merging them.

`index.md` is a routing catalog, not a content dump. Each published note has one compact entry containing its link, one-sentence `description`, category/subcategory, important aliases or tags, season and effective/expiry dates when present. The index is regenerated deterministically on publish, archive and restore.

This design uses the existing database audit trail and Git history rather than introducing an additional append-only `log.md`.

## Input and Output Limits

The worker permits a maximum cleaned document size of 12,000 characters and requests approximately 6,000 output tokens. The system prompt states the same 12,000-character limit. Ordinary notes target 2,000-8,000 characters; dense official schedule tables or rule documents may approach the hard limit. The target is guidance, not a validation failure range.

The direct cleaner must not silently slice raw source text. A configurable maximum cleaning-input size is enforced before the request. When a source exceeds it, the job fails with an actionable message instructing the administrator to split the source by series, season or document chapter. This design does not introduce multi-draft chunking.

## Validation and Evaluation

Structural validation occurs before draft creation:

- Front Matter delimiters must be present at the start of the document.
- Required fields and lengths must pass Zod validation.
- Category and subcategory must be a valid pair.
- Stable and trusted fields (`id`, `source_id`, `source_sha256`) must match application-supplied source metadata rather than merely passing syntactic validation.
- `description`, tags and aliases must satisfy their declared count and length limits.
- Optional content type and dates must conform to their schemas.
- The entire cleaned output must not exceed 12,000 characters.

Structural failure prevents draft creation. Provider configuration errors, timeouts, rate limits, empty responses and invalid model output fail the job with a sanitized, actionable error.

Automatic evaluation remains non-blocking and assesses Front Matter, content length, taxonomy and tags, overlap, freshness and retrievability. Retrievability checks include `description`, tags and aliases because those are the high-value agent-routing fields. The evaluator uses the new taxonomy and 12,000-character ceiling. The existing optional publication score guard remains unchanged. Human review remains mandatory.

Basic Wiki lint checks cover malformed Front Matter, broken index links, duplicate source IDs or hashes, missing source metadata, expired notes and invalid taxonomy. Graph-oriented checks such as orphan nodes, inbound-link coverage or backlink consistency are explicitly excluded.

## Knowledge-Domain Reset

Reset is an explicit, one-time command with a required confirmation flag. It is not a migration and never runs during application startup.

Within a database transaction, it removes knowledge-domain rows in foreign-key-safe order:

1. `evaluation_dimensions`
2. `knowledge_feedback`
3. `knowledge_evaluations`
4. `knowledge_items`
5. `knowledge_drafts`
6. `knowledge_jobs`
7. `knowledge_sources`
8. The obsolete `system_settings` row with key `knowledge.cleaning_backend`

After a successful transaction, it removes only fixed knowledge paths resolved beneath `DATA_ROOT`:

- `uploads/knowledge`
- `extracted`
- `drafts`
- Published Markdown beneath `md-wiki`
- `search-index.json`

It then recreates `md-wiki/index.md` as an empty Wiki index and creates the reviewed `md-wiki/KNOWLEDGE.md` agent retrieval contract. Path-containment checks reject any target outside `DATA_ROOT`. A database failure leaves files untouched. Re-running the reset against an already empty knowledge domain succeeds.

Users, sessions, audit records and unrelated system settings are preserved. Existing audit rows may retain historical resource identifiers without foreign-key targets.

## Administrator Workflow

The Web management workflow is the primary quality boundary:

1. A knowledge administrator uploads a supported file or submits an HTTPS URL.
2. The system persists immutable source material and a normalized text snapshot.
3. The system cleans that source into exactly one candidate note.
4. The administrator compares, edits and evaluates the candidate.
5. The administrator may provide feedback and create a versioned re-clean for the same source note.
6. Only explicit approval publishes the document and rebuilds the compact Wiki index.

No model output is published automatically.

## Testing Strategy

Implementation follows test-driven development.

- Worker tests prove that initial and feedback-driven jobs call only `cleanWithLlmDirect`, use the new limits and do not import or call Qoder cleaning APIs.
- Ingestion tests prove that uploaded originals and URL-derived normalized snapshots are immutable and that a worker never re-fetches a snapshotted source.
- Prompt tests assert one-source/one-note behavior, the fixed note shape, routing metadata, the six-category taxonomy, fidelity priority, official schedule, Sporting Code, beginner, driving/setup, feedback and no-silent-truncation requirements.
- Front Matter tests cover stable IDs and hashes, descriptions, aliases, every valid parent category, representative valid children, invalid cross-category combinations, content types and optional temporal fields.
- Index tests prove entries remain compact, deterministic and useful for routing without embedding note bodies.
- Agent-contract tests verify the index-first, narrow-then-read and citation rules in `KNOWLEDGE.md`.
- Evaluation and lint tests use the routing fields, new taxonomy and content-size ceiling while excluding graph requirements.
- UI and API tests verify that the cleaning-backend switch no longer exists.
- Reset tests verify deletion order, transaction-before-files behavior, path containment, idempotency and preservation of unrelated data.
- Verification runs focused unit tests, the complete test suite, TypeScript checking and linting.

## Success Criteria

- No knowledge-cleaning runtime path imports, invokes or configures Qoder SDK behavior.
- Chat and agent Qoder behavior remains available and unchanged.
- The knowledge UI exposes no cleaning-backend selector or endpoint.
- New drafts use the six-category strict taxonomy and enhanced metadata.
- Every immutable source produces exactly one candidate and published note; no knowledge graph or multi-page compilation is introduced.
- Notes contain an agent-routing summary plus sufficiently complete source-grounded details.
- The cleaner prompt contains content-specific iRacing fidelity rules.
- `index.md` and `KNOWLEDGE.md` support Qoder's index-first, read-only file retrieval and source citation workflow.
- Oversized inputs are rejected explicitly instead of truncated.
- Existing knowledge-domain records and files are reset without altering users, sessions, audits or unrelated settings.
- All focused and full verification commands pass before completion is reported.
