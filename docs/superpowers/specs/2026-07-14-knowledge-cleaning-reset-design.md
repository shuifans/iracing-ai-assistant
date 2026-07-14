# Knowledge Cleaning Reset Design

**Date:** 2026-07-14

## Objective

Rebuild the knowledge-cleaning subsystem around a single OpenAI-compatible LLM path, remove every Qoder SDK dependency from knowledge cleaning while preserving Qoder-based chat/agent behavior, replace the current taxonomy with an iRacing-specific taxonomy, strengthen the cleaning prompt for professional and official racing content, and reset the existing low-quality knowledge data so future content is controlled through the administrator review workflow.

## Scope

This change covers knowledge source ingestion, asynchronous cleaning jobs, cleaning prompts, Front Matter validation, knowledge taxonomy, draft evaluation, the knowledge-management UI, and a one-time knowledge-domain reset.

It does not remove the Qoder SDK package or alter the chat answer pipeline, Wiki retrieval agent, web research agent, or their configuration. It does not add automatic publication or bypass human review.

## Architecture

The knowledge pipeline has one cleaning path:

```text
file or HTTPS URL
  -> source validation and deduplication
  -> asynchronous knowledge job
  -> deterministic text extraction
  -> OpenAI-compatible LLM cleaning
  -> Front Matter and output-size validation
  -> draft persistence
  -> heuristic and retrieval evaluation
  -> administrator edit, feedback/re-clean, approve or reject
  -> Wiki publication, index rebuild and Git commit
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

The knowledge page no longer offers a model selector. Initial cleaning and reviewer-feedback re-cleaning both use the same direct LLM cleaner.

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
title: <1-200 characters>
category: <one of the six categories>
subcategory: <a subcategory valid for the selected category>
tags: [<1-10 source-grounded tags>]
source_name: <optional source publisher or document name>
source_url: <optional valid URL; omit for uploads without a URL>
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

Dates, season identifiers, source names and URLs may be emitted only when present in the source or supplied as trusted source metadata. The cleaner must not infer them.

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
- Use the strict category-to-subcategory mapping.
- Return only the cleaned Markdown document.
- Reviewer feedback may improve structure, classification and wording but may not override source facts.

Content-specific rules:

- Official schedules preserve the season, week, dates, series, cars, tracks, session times and stated timezone. The cleaner does not convert timezones.
- Sporting Code and rule documents preserve applicability, thresholds, exceptions, penalties and modal force; `may`, `should` and `must` are not interchangeable.
- Beginner material preserves prerequisites, action order, UI labels and failure conditions.
- Driving and setup material preserves applicable car, track, weather, tire state, measurement units and operating conditions. Local experience is not generalized into a universal rule.
- Conflicting, incomplete or visibly truncated source material is marked in the draft as requiring administrator review rather than repaired by invention.

Before responding, the model performs an internal checklist for source grounding, taxonomy validity, metadata validity, hierarchy, preserved tables and absence of surrounding commentary. The checklist itself is not output.

## Input and Output Limits

The worker permits a maximum cleaned document size of 12,000 characters and requests approximately 6,000 output tokens. The system prompt states the same 12,000-character limit.

The direct cleaner must not silently slice raw source text. A configurable maximum cleaning-input size is enforced before the request. When a source exceeds it, the job fails with an actionable message instructing the administrator to split the source by series, season or document chapter. This design does not introduce multi-draft chunking.

## Validation and Evaluation

Structural validation occurs before draft creation:

- Front Matter delimiters must be present at the start of the document.
- Required fields and lengths must pass Zod validation.
- Category and subcategory must be a valid pair.
- Optional content type and dates must conform to their schemas.
- The entire cleaned output must not exceed 12,000 characters.

Structural failure prevents draft creation. Provider configuration errors, timeouts, rate limits, empty responses and invalid model output fail the job with a sanitized, actionable error.

Automatic evaluation remains non-blocking and assesses Front Matter, content length, taxonomy and tags, overlap, freshness and retrievability. The evaluator uses the new taxonomy and 12,000-character ceiling. The existing optional publication score guard remains unchanged. Human review remains mandatory.

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

It then recreates `md-wiki/index.md` as an empty Wiki index. Path-containment checks reject any target outside `DATA_ROOT`. A database failure leaves files untouched. Re-running the reset against an already empty knowledge domain succeeds.

Users, sessions, audit records and unrelated system settings are preserved. Existing audit rows may retain historical resource identifiers without foreign-key targets.

## Administrator Workflow

The Web management workflow is the primary quality boundary:

1. A knowledge administrator uploads a supported file or submits an HTTPS URL.
2. The system extracts and cleans it into a candidate draft.
3. The administrator compares, edits and evaluates the candidate.
4. The administrator may provide feedback and create a versioned re-clean.
5. Only explicit approval publishes the document and rebuilds the Wiki index.

No model output is published automatically.

## Testing Strategy

Implementation follows test-driven development.

- Worker tests prove that initial and feedback-driven jobs call only `cleanWithLlmDirect`, use the new limits and do not import or call Qoder cleaning APIs.
- Prompt tests assert the six-category taxonomy, fidelity priority, official schedule, Sporting Code, beginner, driving/setup, feedback and no-silent-truncation requirements.
- Front Matter tests cover every valid parent category, representative valid children, invalid cross-category combinations, content types and optional temporal fields.
- Evaluation tests use the new taxonomy and content-size ceiling.
- UI and API tests verify that the cleaning-backend switch no longer exists.
- Reset tests verify deletion order, transaction-before-files behavior, path containment, idempotency and preservation of unrelated data.
- Verification runs focused unit tests, the complete test suite, TypeScript checking and linting.

## Success Criteria

- No knowledge-cleaning runtime path imports, invokes or configures Qoder SDK behavior.
- Chat and agent Qoder behavior remains available and unchanged.
- The knowledge UI exposes no cleaning-backend selector or endpoint.
- New drafts use the six-category strict taxonomy and enhanced metadata.
- The cleaner prompt contains content-specific iRacing fidelity rules.
- Oversized inputs are rejected explicitly instead of truncated.
- Existing knowledge-domain records and files are reset without altering users, sessions, audits or unrelated settings.
- All focused and full verification commands pass before completion is reported.
