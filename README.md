# meta-cv-hackathon
Meta Global AI Developer Hackathon

## Goal
Take a screenshot (e.g. phone, laptop, dog) and turn it into a beginner-friendly study guide with sources.

Demo scope is 3 targets only: phone, laptop, dog. One working flow beats full-room detection.

## Pipeline
1. Input: live capture first (phone / laptop camera via browser), upload as fallback.
2. Detect: open-vocab detector finds boxes for phone / laptop / dog. User picks one if several match.
3. Overview: crop the picked box, send to vision model for short summary. Show it in side panel.
4. Prompt: ask "Want to learn how this works?" If no, stop here.
5. Level check: ask familiarity - total beginner, some idea, degree-level. Default is assume nothing.
6. Study guide: generate Chapter 1 only, beginner-first. Next chapters on demand.
7. Sources + quiz: each chapter has links/sources and a 3-question check. Side panel shows guide, sources, quiz.

## Non-goals for hackathon
Full-room multi-object scan, full course upfront, generated 3D internals. Add those only after the 3-object flow works live.

## Setup (fresh clone)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install fastapi uvicorn python-multipart
.\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 in your browser. Click Start camera, then Capture. Upload works as fallback.

First run downloads `yolov8s-worldv2.pt` automatically. Leave that terminal running while you demo.
