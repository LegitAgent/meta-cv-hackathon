# Specification: Camera-Based Learning Assistant

Track: Build for Your World

## Why
I constantly wonder how things work. How are basketballs made? What is this thing in front of me? AI can answer, but it takes switching apps, searching, and guessing what to trust.

This demo streamlines that into one flow: point, pick, learn.

## Project goal

Build a hackathon demo that lets curious people of any age capture an object, choose what they want to learn about it, and receive an accessible study guide grounded in trusted references.

Deadline: November 5, 2026. Approximately two days remain.

Prioritize one reliable end-to-end experience over broad object coverage or advanced features.

## Core experience

1. The user captures an image with their browser camera or uploads an image.
2. The app detects supported objects and displays labeled bounding boxes.
3. The user selects an object and confirms or corrects its label.
4. The app displays learning topics relevant to that object.
5. The user selects a topic or asks their own question through text or microphone.
6. The app asks their familiarity:
   - Total beginner — default
   - Some familiarity
   - Advanced / degree-level
7. The app generates Chapter 1 with explanations, trusted sources, and a three-question quiz.
8. Additional chapters are generated only when requested.

The user chooses the object and learning topic before the AI begins teaching. Do not automatically generate a lesson immediately after detection.

## Audience and teaching approach

The audience is curious people of any age.

- Use clear language and explain unfamiliar terms.
- Adapt depth to the selected familiarity level.
- Do not infer age or knowledge from the camera image.
- For beginners, assume no prior subject knowledge.
- Use concrete examples and analogies without sacrificing accuracy.
- Keep the initial chapter short enough to read during a live demo.

## Demo scope

Supported objects:

- Phone
- Laptop
- Dog

The existing backend also includes headset; remove it from the demo configuration unless scope is explicitly expanded. Other objects (e.g. basketballs) are vision examples, not demo targets.

Out of scope:

- Full-room analysis
- Recognition of arbitrary objects
- Facial recognition or identifying the user
- Full courses generated upfront
- Generated 3D internals
- Custom detector training
- Accounts and persistent learning profiles

## Current implementation

The project uses:

- FastAPI backend in app.py
- Plain HTML and JavaScript frontend in index.html
- Ultralytics YOLO-World model: yolov8s-worldv2.pt
- Browser camera capture and image upload
- A /detect endpoint returning labels, confidence scores, and bounding boxes

Current limitations:

- Results are displayed as JSON.
- Bounding-box selection is not implemented.
- Camera frames are forced into a 480 × 360 canvas.
- Detection uses a confidence threshold of 0.15.
- Learning topics, microphone input, lesson generation, sources, and quizzes are not implemented.

## Object detection requirements

YOLO-World is an open-vocabulary object detector. Text classes specify what it should search for; setting classes does not train the model or guarantee correct recognition.

### Image capture

- Preserve the camera frame’s original aspect ratio.
- Capture using the video’s actual dimensions.
- Resize the preview independently from the image sent for detection.
- Disable capture until the camera is ready.
- Provide upload fallback when camera access fails.

### Detection configuration

- Compare ["cell phone", "laptop", "dog"] with the existing class wording.
- Map model labels to consistent user-facing names.
- Make the confidence threshold configurable.
- Evaluate thresholds such as 0.15, 0.25, 0.35, and 0.45.
- Select settings based on observed results, not an assumed universally correct threshold.
- If needed, compare yolov8m-worldv2.pt with the existing small model, measuring both accuracy and latency.

Increasing the confidence threshold filters weaker detections but may also hide correct detections. It does not improve the underlying model.

### Selection and recovery

- Draw labeled bounding boxes over the captured image.
- Keep box coordinates aligned when the preview is resized.
- Let the user select a detected object.
- Provide an option to correct the label to another supported object.
- If nothing suitable is detected, offer retry, upload, or manual selection of a supported object.
- Clearly distinguish manual selection from model recognition.
- Do not treat confidence scores as guaranteed probabilities of correctness.

## Learning topic choices

For the demo, use predefined topic menus.

| Object | Suggested topics |
|---|---|
| Phone | Touchscreens, internet connectivity, internal components, cameras |
| Laptop | Processors and memory, operating systems, batteries, displays |
| Dog | Senses, communication and behavior, basic biology, learning |

Each menu must also include “Ask something else” with text input and optional microphone input.

These topics are proposed demo defaults and can be adjusted.

## Microphone input

The microphone lets users express a learning question.

- Use explicit start and stop recording controls.
- Show recording and processing states.
- Display the interpreted question for review before submission.
- Allow editing or retrying.
- Keep text input available if microphone access or audio processing fails.
- Do not record continuously in the background.

Voice output is not required for the initial demo.

## Model integration

Use Muse through the selected inference provider.

The supplied hackathon instructions specify this Baseten model identifier:

meta-models/muse-spark-open-1026

Do not substitute meta-models/muse-spark-open without checking the hackathon requirements.

Before implementing requests, verify the provider’s current API format and supported image/audio inputs.

Relevant documentation:

- Chat completions (https://docs.baseten.co/reference/inference-api/chat-completions)
- Vision (https://docs.baseten.co/inference/model-apis/vision)
- Audio (https://docs.baseten.co/inference/model-apis/audio)

Keep provider credentials on the backend in environment variables.

### Inference providers

Available inference providers: Baseten, Fireworks, and Modal. Access is available, but credits, model availability, and endpoint compatibility still need verification.

Use whichever provider supports the required hackathon Muse model and is quickest to integrate reliably. The model identifier meta-models/muse-spark-open-1026 comes from the supplied Baseten instructions; do not assume Fireworks or Modal uses the same identifier.

Integrate one provider for the initial demo. Keep provider configuration on the backend so it can be changed later. Multi-provider routing and automatic failover are outside the two-day scope.

Having all three gives you deployment options; you don’t need to use all three in the demo.

### Responsibilities

- YOLO-World: Locate candidate supported objects.
- User: Confirm the object, select the topic, and choose familiarity.
- Application: Supply the relevant trusted reference material.
- Muse: Generate the explanation and quiz grounded in that material.

The selected image crop may provide visual context, but the model must not invent hidden details, exact device specifications, or a dog’s breed from insufficient evidence.

## Trusted references

Use a small curated reference collection for the predefined topics.

Each reference should include:

- Stable source ID
- Title
- Publisher or organization
- URL
- Relevant source text or a reviewed excerpt

Provide actual reference content to the model. A list of URLs alone is insufficient grounding.

Source requirements:

- Prefer authoritative educational, scientific, institutional, or manufacturer material appropriate to the topic.
- Cite only sources supplied by the application.
- Do not fabricate links, quotations, or source claims.
- Associate citations with the explanations they support.
- If an open-ended question is not covered, explain the limitation and offer supported topics rather than inventing a sourced answer.

Live web research is not required for the demo.

## Chapter output

Chapter 1 should contain:

1. A title tied to the chosen topic.
2. A brief learning objective.
3. A concise explanation adapted to familiarity.
4. Definitions of essential terms.
5. A concrete example or analogy.
6. Source citations and links.
7. A three-question comprehension quiz.
8. A suggested next chapter.

Quiz answers and short explanations should be available after the user submits their responses.

Use structured model output where supported so the frontend can render sections reliably. Validate the response before displaying it.

## Interface

Use a simple layout with:

- Camera or captured-image area
- Selectable detection boxes
- Selected-object label
- Topic choices
- Text and microphone question input
- Familiarity selector
- Study-guide panel with sources and quiz

Provide clear loading and error states for detection, audio processing, and lesson generation. Preserve the user’s choices when a request fails.

## Validation

Create a small evaluation set of approximately 20–30 representative images covering:

- Each supported object
- Different lighting, distances, and orientations
- Multiple supported objects
- Visually confusing objects
- Images containing no supported objects

Compare:

- Incorrect detections
- Missed objects
- Label correctness
- Response time

Record which detector settings provide the best practical demo experience. Do not claim measured accuracy until evaluation has been performed.

## Acceptance criteria

The demo is complete when:

- Camera capture and upload both work.
- Images preserve their aspect ratio.
- Supported detections appear as selectable labeled boxes.
- Users can recover from missing or incorrect detections.
- Selecting an object displays relevant topic choices.
- Users select a topic before lesson generation.
- Text questions work, and microphone questions can be reviewed before submission.
- Familiarity affects lesson depth.
- Chapter 1 contains grounded explanations, working source links, and three quiz questions.
- Additional chapters require an explicit request.
- API credentials are never exposed to the browser.
- The full flow works on the intended demo machine.

## Implementation priority

1. Fix image capture and add bounding-box selection.
2. Add object confirmation, predefined topics, and familiarity selection.
3. Build curated reference packs.
4. Integrate Muse for a sourced first chapter and quiz.
5. Add microphone input with text fallback.
6. Tune detection using the evaluation images.
7. Rehearse the complete demo and failure-recovery paths.
