# Document quality

Resume writing, cover letters and skills translation use a shared writing policy and the same OpenAI request adapter. The production default is `gpt-5.4`, with low reasoning effort, strict structured output and `store: false`. Its model ID, Responses support and structured output support were checked against [OpenAI's model documentation](https://developers.openai.com/api/docs/models/gpt-5.4) on October 30, 2026.

`VCP_DOCUMENT_AI_MODEL` overrides the writing model. `VCP_DOCUMENT_AI_FALLBACK_MODEL` overrides the existing `gpt-4.1-mini` compatibility fallback. A fallback occurs only for an explicit model-access error, within the original request deadline. Authentication, billing, rate limits and transport failures do not trigger another generation. Paid document recovery and ownership checks are unchanged. Anthropic deployments retain their existing provider adapter and receive the shared writing policy.

The shared skill organizer groups clearly recognized, explicitly supplied skills by function. It preserves distinct systems and manual categories. Unknown terms remain visible under Additional skills; a military code does not create a civilian skill, license or qualification. The public renderer organizes only the selected public snapshot. It never reads the private profile to enrich a shared CV.

Regression fixtures cover 12 mixed military/civilian backgrounds, all six branches, Guard/Reserve contexts, unfamiliar tools/codes, separate ERP/WMS systems, custom categories, PDF line wrapping, repeated normalization and privacy choices. Provider-adapter tests cover structured requests, shared instructions, model-access fallback and protected purchase recovery. The public browser checks exercise the same fixtures at desktop document width on a mobile screen.

These tests establish application behavior and factual-preservation rules; they are not a benchmark proving that every model-written sentence or every possible skill category is correct. The applicant still reviews the draft and answers specific clarification questions. Add new fictional examples to the regression fixtures when a real-world ambiguity is found.
