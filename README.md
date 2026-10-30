# meta-cv-hackathon
Meta Global AI Developer Hackathon

## Goal
Take a screenshot (e.g. phone, laptop, dog) and turn it into a beginner-friendly study guide with sources.

Demo scope is 3 targets only: phone, laptop, dog. One working flow beats full-room detection.

## Pipeline
1. Input: user uploads a screenshot.
2. Detect: open-vocab detector finds boxes for phone / laptop / dog. User picks one if several match.
3. Overview: crop the picked box, send to vision model for short summary. Show it in side panel.
4. Prompt: ask "Want to learn how this works?" If no, stop here.
5. Level check: ask familiarity - total beginner, some idea, degree-level. Default is assume nothing.
6. Study guide: generate Chapter 1 only, beginner-first. Next chapters on demand.
7. Sources + quiz: each chapter has links/sources and a 3-question check. Side panel shows guide, sources, quiz.

## Does this need RAG?
Yes, for the study guide part. Without retrieval the model will hallucinate sources.

Keep it simple: query -> web search -> keep top 3-5 sources -> generate chapter grounded in those sources -> display links with the chapter.

Detection + overview does not need RAG. Study guide does.

## Non-goals for hackathon
Full-room multi-object scan, full course upfront, generated 3D internals. Add those only after the 3-object flow works live.
